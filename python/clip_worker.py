#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Controlled local CLIP embedding worker for the Grimoire desktop application.

Structurally mirrors python/wd14_worker.py: a loopback-only HTTP service guarded
by a per-launch token, one JSON "ready" line on stdout for the Electron process
manager, and Chinese domain errors surfaced verbatim in the UI. The optional
runtime dependencies (onnxruntime, numpy, Pillow) are probed instead of imported
eagerly so /health can report a degraded environment instead of dying at import.

Model directory resolution (same pattern as the WD14 tagger):
  1. `--model-dir <path>` argument, or a bare first argument
  2. MDS_CLIP_MODEL_DIR environment variable
  3. python/models/clip next to this file
"""

import base64
import glob
import hmac
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

TOKEN = os.environ.get('GRIMOIRE_CLIP_TOKEN', '')
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_JSON_BYTES = 140 * 1024 * 1024

# CLIP image preprocessing constants from the reference implementation
# (Radford et al. 2021, "Learning Transferable Visual Models From Natural
# Language Supervision"; openai/CLIP `clip/clip.py::_transform` and transformers
# `CLIPImageProcessor`): the shorter edge is resized to 224 with bicubic
# interpolation, the center 224x224 crop is taken, pixels are scaled to [0, 1]
# and normalized per channel with the published mean and std below.
CLIP_INPUT_SIZE = 224
CLIP_MEAN = (0.48145466, 0.4578275, 0.40821073)
CLIP_STD = (0.26862954, 0.26130258, 0.27577711)

# Optional runtime dependencies, filled in by probe_runtime().
_onnxruntime = None
_numpy = None
_pil_image = None
_pil_image_ops = None

_active_model_id = None
_session = None


def resolve_model_directory():
    """Resolve the model directory with the WD14 worker's precedence."""
    arguments = sys.argv[1:]
    for index, value in enumerate(arguments):
        if value == '--model-dir' and index + 1 < len(arguments):
            return os.path.abspath(arguments[index + 1])
    if arguments and not arguments[0].startswith('--'):
        return os.path.abspath(arguments[0])
    configured = os.environ.get('MDS_CLIP_MODEL_DIR', '')
    if configured:
        return os.path.abspath(configured)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'clip')


MODEL_DIR = resolve_model_directory()


def scan_models():
    """List the .onnx CLIP vision towers available in MODEL_DIR.

    Each entry: {id, name, onnx, size_mb}. `id` is the file stem accepted by
    /embed and /switch; `name` is a readable label for the UI.
    """
    os.makedirs(MODEL_DIR, exist_ok=True)

    models = []
    for onnx_path in sorted(glob.glob(os.path.join(MODEL_DIR, '*.onnx'))):
        basename = os.path.splitext(os.path.basename(onnx_path))[0]
        models.append({
            'id': basename,
            'name': basename.replace('_', ' ').replace('-', ' ').strip() or basename,
            'onnx': os.path.basename(onnx_path),
            'size_mb': round(os.path.getsize(onnx_path) / (1024 * 1024), 1),
        })
    return models


def probe_runtime():
    """Import the optional dependencies without raising.

    Returns (runtime, version): runtime is 'onnxruntime' only when every
    dependency needed for embedding is importable, and version is the
    onnxruntime version when that package alone imported.
    """
    global _onnxruntime, _numpy, _pil_image, _pil_image_ops

    version = None
    try:
        import onnxruntime as ort
        _onnxruntime = ort
        version = ort.__version__
    except Exception:
        _onnxruntime = None
    try:
        import numpy as np
        _numpy = np
    except Exception:
        _numpy = None
    try:
        from PIL import Image, ImageOps
        _pil_image = Image
        _pil_image_ops = ImageOps
    except Exception:
        _pil_image = None
        _pil_image_ops = None

    runtime = 'onnxruntime' if _onnxruntime is not None and _numpy is not None and _pil_image is not None else None
    return runtime, version


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def authorized(handler):
    provided = handler.headers.get('X-Grimoire-Worker-Token', '')
    return bool(TOKEN) and hmac.compare_digest(provided, TOKEN)


# ============================================================
#  模型加载与切换
# ============================================================

def _load_session(onnx_path):
    """Create an onnxruntime session, preferring CUDA when it is available."""
    global _session

    if _session is not None:
        return

    runtime, _ = probe_runtime()
    if runtime is None:
        raise RuntimeError('缺少 onnxruntime / numpy / Pillow 依赖，无法加载模型')
    if not os.path.isfile(onnx_path):
        raise FileNotFoundError('模型 .onnx 文件未找到: ' + onnx_path)

    providers = ['CPUExecutionProvider']
    if 'CUDAExecutionProvider' in _onnxruntime.get_available_providers():
        providers.insert(0, 'CUDAExecutionProvider')
        print('[CLIP] CUDA GPU 加速', flush=True)
    else:
        print('[CLIP] CPU 推理', flush=True)

    print('[CLIP] 加载模型: ' + os.path.basename(onnx_path), flush=True)
    _session = _onnxruntime.InferenceSession(onnx_path, providers=providers)


def switch_model(model_id):
    """Load the given model, reusing the current session when it is unchanged."""
    global _active_model_id, _session

    models = scan_models()
    target = None
    for model in models:
        if model['id'] == model_id:
            target = model
            break

    if target is None:
        return {'success': False, 'error': f'模型 "{model_id}" 不可用'}

    if _active_model_id == model_id and _session is not None:
        return {'success': True, 'model': model_id}

    # 释放旧模型后再加载新模型
    _session = None
    _active_model_id = model_id
    try:
        _load_session(os.path.join(MODEL_DIR, target['onnx']))
    except Exception as error:
        _active_model_id = None
        _session = None
        return {'success': False, 'error': str(error)}

    return {'success': True, 'model': model_id}


# ============================================================
#  预处理与推理
# ============================================================

def _read_image(image_path):
    """Read an image file, enforcing the absolute-path and size contract."""
    if not os.path.isabs(image_path):
        raise ValueError('图片路径必须是绝对路径: ' + image_path)
    if not os.path.isfile(image_path):
        raise FileNotFoundError('图片文件未找到: ' + image_path)
    size = os.path.getsize(image_path)
    if size <= 0 or size > MAX_IMAGE_BYTES:
        raise ValueError('图片大小无效: ' + image_path)
    with open(image_path, 'rb') as handle:
        return handle.read()


def _preprocess_image(image_bytes, layout):
    """CLIP-standard preprocessing; returns a float32 NCHW/NHWC batch tensor."""
    if _pil_image is None or _numpy is None:
        probe_runtime()
    if _pil_image is None:
        raise RuntimeError('缺少 Pillow 依赖，无法预处理图片')
    if _numpy is None:
        raise RuntimeError('缺少 numpy 依赖，无法预处理图片')

    Image = _pil_image
    np = _numpy

    image = Image.open(io.BytesIO(image_bytes))
    # Respect EXIF orientation before resizing, matching the reference loader;
    # images without an orientation tag are unchanged.
    image = _pil_image_ops.exif_transpose(image)
    if image.mode != 'RGB':
        image = image.convert('RGB')

    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError('图片尺寸无效')

    # openai/CLIP Resize(n_px): scale the shorter edge to 224 (bicubic) and keep
    # the aspect ratio; torchvision truncates the longer edge with int(), so the
    # same truncation is used here.
    scale = CLIP_INPUT_SIZE / float(min(width, height))
    new_width = max(CLIP_INPUT_SIZE, int(width * scale))
    new_height = max(CLIP_INPUT_SIZE, int(height * scale))
    image = image.resize((new_width, new_height), Image.BICUBIC)

    # openai/CLIP CenterCrop(n_px): torchvision rounds the crop offsets.
    left = int(round((new_width - CLIP_INPUT_SIZE) / 2.0))
    top = int(round((new_height - CLIP_INPUT_SIZE) / 2.0))
    image = image.crop((left, top, left + CLIP_INPUT_SIZE, top + CLIP_INPUT_SIZE))

    # ToTensor() then Normalize(mean, std): scale to [0, 1], then standardize.
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - np.asarray(CLIP_MEAN, dtype=np.float32)) / np.asarray(CLIP_STD, dtype=np.float32)

    if layout == 'nhwc':
        array = np.expand_dims(array, 0)
    else:
        array = np.expand_dims(array.transpose(2, 0, 1), 0)
    return np.ascontiguousarray(array, dtype=np.float32)


def _select_visual_input(session):
    """Pick the pixel input tensor and its memory layout from the ONNX graph."""
    for item in session.get_inputs():
        shape = item.shape if isinstance(item.shape, (list, tuple)) else []
        if len(shape) == 4:
            if shape[1] == 3:
                return item.name, 'nchw'
            if shape[3] == 3:
                return item.name, 'nhwc'
    first = session.get_inputs()[0]
    return first.name, 'nchw'


def _select_embedding_output(session):
    """Pick the image-embedding tensor from the vision tower outputs.

    OpenCLIP/transformers exports name the projected embedding
    `image_embeds`/`pooler_output` with rank 2; plain vision-tower exports may
    only expose `last_hidden_state` with rank 3, where the first token is the
    CLS summary the projection head consumes. Returns (index, squeeze_cls) or
    (None, False) when no output can be interpreted as an embedding.
    """
    candidates = []
    for index, output in enumerate(session.get_outputs()):
        shape = output.shape if isinstance(output.shape, (list, tuple)) else []
        name = str(output.name).lower()
        named = 'embed' in name or 'pool' in name
        if len(shape) == 2:
            candidates.append((0 if named else 1, index, False))
        elif len(shape) == 3:
            candidates.append((2 if named else 3, index, True))

    if not candidates:
        return None, False
    candidates.sort()
    _, index, squeeze_cls = candidates[0]
    return index, squeeze_cls


def _extract_vector(raw_output, squeeze_cls):
    """Take one image's embedding from a batch output and L2-normalize it."""
    if _numpy is None:
        probe_runtime()
    if _numpy is None:
        raise RuntimeError('缺少 numpy 依赖，无法提取嵌入')
    np = _numpy

    value = np.asarray(raw_output)
    if squeeze_cls or value.ndim == 3:
        # CLS token at sequence position 0 is the pooled image summary.
        value = value[:, 0, :]
    if value.ndim > 2:
        value = value.reshape(value.shape[0], -1)
    vector = np.asarray(value[0], dtype=np.float32).reshape(-1)

    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector = vector / norm
    return vector


def embed_images(image_paths, model_id=None):
    """Embed each image path and return {model, dims, vectors}.

    vectors are base64-encoded float32 little-endian buffers, one per input
    path in order, each L2-normalized so cosine similarity is a dot product.
    Returns {'error': ...} for environment problems (mirroring wd14 predict)
    and raises for invalid image input.
    """
    if model_id is not None and model_id != _active_model_id:
        result = switch_model(model_id)
        if not result.get('success'):
            return {'error': result.get('error', '模型切换失败')}

    if _active_model_id is None or _session is None:
        models = scan_models()
        if not models:
            return {'error': '模型文件未找到。请将 CLIP 视觉塔 .onnx 文件放入模型目录。'}
        result = switch_model(models[0]['id'])
        if not result.get('success'):
            return {'error': result.get('error', '模型加载失败')}

    input_name, layout = _select_visual_input(_session)
    output_index, squeeze_cls = _select_embedding_output(_session)
    if output_index is None:
        return {'error': '模型输出无法解析为图像嵌入，请使用导出的 CLIP 视觉塔模型'}

    vectors = []
    dims = 0
    for image_path in image_paths:
        image_bytes = _read_image(image_path)
        tensor = _preprocess_image(image_bytes, layout)
        outputs = _session.run(None, {input_name: tensor})
        vector = _extract_vector(outputs[output_index], squeeze_cls)
        dims = int(vector.size)
        vectors.append(base64.b64encode(vector.astype('<f4').tobytes()).decode('ascii'))

    return {'model': _active_model_id, 'dims': dims, 'vectors': vectors}


class Handler(BaseHTTPRequestHandler):
    server_version = 'GrimoireCLIP/1'

    def log_message(self, format, *args):
        # Keep stdout machine-readable for the Electron process manager.
        return

    def do_GET(self):
        if not authorized(self):
            json_response(self, 401, {'error': 'unauthorized'})
            return
        path = urlparse(self.path).path
        if path == '/health':
            self.handle_health()
        elif path == '/models':
            json_response(self, 200, {'models': scan_models()})
        else:
            json_response(self, 404, {'error': 'not_found'})

    def do_POST(self):
        if not authorized(self):
            json_response(self, 401, {'error': 'unauthorized'})
            return
        path = urlparse(self.path).path
        if path == '/embed':
            self.handle_embed()
        elif path == '/switch':
            self.handle_switch()
        else:
            json_response(self, 404, {'error': 'not_found'})

    def read_json(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > MAX_JSON_BYTES:
            raise ValueError('invalid request size')
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def handle_health(self):
        # Never raise: a missing dependency must surface as runtime=null and a
        # missing model directory as an empty list, so the Electron side can
        # show an actionable message instead of a dead worker.
        runtime, version = probe_runtime()
        try:
            models = scan_models()
        except Exception:
            models = []
        json_response(self, 200, {
            'ok': runtime is not None and len(models) > 0,
            'runtime': runtime,
            'runtimeVersion': version,
            'models': models,
            'modelDir': MODEL_DIR,
        })

    def handle_switch(self):
        try:
            body = self.read_json()
            model_id = body.get('model_id') if isinstance(body, dict) else None
            if not isinstance(model_id, str) or not model_id:
                raise ValueError('model_id is required')
            result = switch_model(model_id)
            json_response(self, 200 if result.get('success') else 400, result)
        except Exception as error:
            json_response(self, 400, {'error': str(error)})

    def handle_embed(self):
        try:
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('application/json'):
                raise ValueError('JSON request required')
            body = self.read_json()
            image_paths = body.get('imagePaths') if isinstance(body, dict) else None
            if not isinstance(image_paths, list) or not image_paths:
                raise ValueError('imagePaths is required')
            if not all(isinstance(path, str) and path.strip() for path in image_paths):
                raise ValueError('imagePaths is invalid')
            model_id = body.get('model')
            if model_id is not None and not isinstance(model_id, str):
                raise ValueError('model is invalid')
            result = embed_images(list(image_paths), model_id=model_id)
            json_response(self, 200 if 'error' not in result else 503, result)
        except Exception as error:
            json_response(self, 400, {'error': str(error)})


def main():
    port = int(os.environ.get('GRIMOIRE_CLIP_PORT', '0'))
    if not TOKEN:
        raise RuntimeError('GRIMOIRE_CLIP_TOKEN is required')
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(json.dumps({'ready': True, 'port': server.server_address[1]}, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
