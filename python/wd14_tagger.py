#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
WD14 Tagger - ONNX推理引擎模块
支持 SmilingWolf WD14 系列（wd-v1-4 / wd-vit 等变体）
自动扫描 models/ 目录，支持多模型切换
"""

import os
import io
import csv
import glob
import numpy as np
from PIL import Image

# 模型目录
MODEL_DIR = os.environ.get('MDS_WD14_MODEL_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models'))

# 默认参数
DEFAULT_THRESHOLD = 0.35
INPUT_SIZE = 448  # WD14 系列模型默认输入尺寸（wd-vit-large-tagger-v3 亦为 448）

# 分类ID -> 名称映射
CATEGORY_NAMES = {
    0: 'general',
    4: 'character',
    7: 'rating',
    9: 'quality',
}

# ============================================================
#  模型注册表：每个 .onnx 自动配对同名 .csv
# ============================================================

def scan_models():
    """
    扫描 models/ 目录，返回所有可用模型的列表。
    每个模型由 .onnx 文件 + 同名 .csv 文件组成。
    返回: list of dict, 每个 {id, name, onnx, csv, size_mb, tag_count_approx}
    """
    os.makedirs(MODEL_DIR, exist_ok=True)

    onnx_files = sorted(glob.glob(os.path.join(MODEL_DIR, '*.onnx')))
    models = []

    for onnx_path in onnx_files:
        basename = os.path.splitext(os.path.basename(onnx_path))[0]
        csv_path = os.path.join(MODEL_DIR, basename + '.csv')

        # 如果同名csv不存在，尝试匹配任何csv
        if not os.path.exists(csv_path):
            csv_candidates = glob.glob(os.path.join(MODEL_DIR, '*.csv'))
            # 跳过已与其他onnx配对的csv
            paired_csvs = set()
            for other_onnx in onnx_files:
                if other_onnx == onnx_path:
                    continue
                other_base = os.path.splitext(os.path.basename(other_onnx))[0]
                other_csv = os.path.join(MODEL_DIR, other_base + '.csv')
                if os.path.exists(other_csv):
                    paired_csvs.add(other_csv)
            unpaired = [c for c in csv_candidates if c not in paired_csvs]
            if unpaired:
                csv_path = unpaired[0]
            else:
                csv_path = None

        size_mb = round(os.path.getsize(onnx_path) / (1024 * 1024), 1)

        # 快速估算tag数量（读csv行数）
        tag_count = 0
        if csv_path and os.path.exists(csv_path):
            try:
                with open(csv_path, 'r', encoding='utf-8') as f:
                    tag_count = sum(1 for _ in f) - 1  # 减去header
            except Exception:
                pass

        # 生成友好显示名
        display_name = basename
        # wd-v1-4-moat-tagger-v2 -> WD14 MOAT v2
        name_map = {
            'convnext': 'ConvNeXt',
            'swinv2': 'SwinV2',
            'vit': 'ViT',
            'moat': 'MOAT',
            'efv2': 'EfficientNetV2',
            'mobileconvnext': 'MobileConvNeXt',
            'vit-v2': 'ViT v2',
            'convnext-v2': 'ConvNeXt v2',
            'swinv2-v2': 'SwinV2 v2',
            'moat-v2': 'MOAT v2',
        }
        lower = basename.lower()
        for key, val in name_map.items():
            if key in lower:
                display_name = val
                break

        models.append({
            'id': basename,               # 唯一标识（文件名去扩展名）
            'name': display_name,          # 友好显示名
            'onnx': os.path.basename(onnx_path),
            'csv': os.path.basename(csv_path) if csv_path else None,
            'size_mb': size_mb,
            'tag_count': max(tag_count, 0),
            'has_csv': csv_path is not None and os.path.exists(csv_path),
        })

    return models


# ============================================================
#  当前活跃模型状态
# ============================================================

_active_model_id = None   # 当前选中的模型id
_model_session = None     # onnxruntime InferenceSession
_all_tags = None           # list of dicts
_onnx_path = None          # 当前 .onnx 绝对路径
_csv_path = None           # 当前 .csv 绝对路径


def _model_dir_path(filename):
    """根据文件名拼出 models/ 下的绝对路径"""
    return os.path.join(MODEL_DIR, filename) if filename else None


def get_active_model_id():
    """返回当前活跃模型的id"""
    return _active_model_id


def switch_model(model_id):
    """
    切换到指定模型。如果模型已经是当前的则不重新加载。
    返回: dict {success, error?, model_name, tag_count}
    """
    global _active_model_id, _model_session, _all_tags, _onnx_path, _csv_path

    models = scan_models()
    target = None
    for m in models:
        if m['id'] == model_id and m['has_csv']:
            target = m
            break

    if target is None:
        return {'success': False, 'error': f'模型 "{model_id}" 不可用（缺少 .csv 文件）'}

    # 如果已经是当前模型，不重新加载
    if _active_model_id == model_id and _model_session is not None:
        return {'success': True, 'model_name': target['name'], 'tag_count': len(_all_tags) if _all_tags else 0}

    # 释放旧模型
    _model_session = None
    _all_tags = None
    _onnx_path = _model_dir_path(target['onnx'])
    _csv_path = _model_dir_path(target['csv'])
    _active_model_id = model_id

    # 立即加载新模型
    try:
        _load_model()
    except Exception as e:
        _active_model_id = None
        _model_session = None
        return {'success': False, 'error': str(e)}

    return {'success': True, 'model_name': target['name'], 'tag_count': len(_all_tags) if _all_tags else 0}


def is_model_available():
    """检查是否有任何可用模型"""
    models = scan_models()
    return any(m['has_csv'] for m in models)


def _load_tags():
    """加载当前CSV标签列表"""
    global _all_tags
    if _all_tags is not None:
        return

    if _csv_path is None or not os.path.exists(_csv_path):
        raise FileNotFoundError("未找到 .csv 标签文件")

    _all_tags = []
    with open(_csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            tag_name = row.get('name', '').strip()
            if not tag_name:
                continue
            try:
                category = int(row.get('category', 0))
            except (ValueError, TypeError):
                category = 0
            try:
                idx = int(row.get('index', row.get('tag_id', i)))
            except (ValueError, TypeError):
                idx = i
            _all_tags.append({'name': tag_name, 'category': category, 'index': idx})


def _load_model():
    """加载当前ONNX模型"""
    global _model_session

    if _model_session is not None:
        return

    if _onnx_path is None or not os.path.exists(_onnx_path):
        raise FileNotFoundError("模型 .onnx 文件未找到")

    import onnxruntime as ort
    _load_tags()

    providers = ['CPUExecutionProvider']
    available = ort.get_available_providers()
    if 'CUDAExecutionProvider' in available:
        providers.insert(0, 'CUDAExecutionProvider')
        print(f'[WD14] CUDA GPU 加速')
    else:
        print(f'[WD14] CPU 推理')

    onnx_name = os.path.basename(_onnx_path)
    print(f'[WD14] 加载模型: {onnx_name}')
    _model_session = ort.InferenceSession(_onnx_path, providers=providers)
    print(f'[WD14] 模型就绪，共 {len(_all_tags)} 个标签')


def _preprocess_image(image_bytes):
    """预处理图片，自动适配NHWC/NCHW"""
    img = Image.open(io.BytesIO(image_bytes))

    if img.mode == 'RGBA':
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    input_size = INPUT_SIZE
    nhwc_format = True

    if _model_session is not None:
        input_info = _model_session.get_inputs()[0]
        shape = input_info.shape
        if len(shape) == 4:
            if isinstance(shape[3], int) and shape[3] == 3:
                nhwc_format = True
                input_size = shape[1] if isinstance(shape[1], int) else INPUT_SIZE
            elif isinstance(shape[1], int) and shape[1] == 3:
                nhwc_format = False
                input_size = shape[2] if isinstance(shape[2], int) else INPUT_SIZE

    img = img.resize((input_size, input_size), Image.BILINEAR)
    # WD14系列模型(tf2onnx导出)期望0-255范围的float32输入
    # 不能除以255! 否则像素值全接近0，模型会把图片当成全黑
    arr = np.array(img, dtype=np.float32)

    if nhwc_format:
        arr = np.expand_dims(arr, 0)
    else:
        arr = arr.transpose(2, 0, 1)
        arr = np.expand_dims(arr, 0)

    return arr


def predict(image_bytes, threshold=DEFAULT_THRESHOLD, model_id=None):
    """
    对图片运行推理。
    model_id: 如果指定，先切换到该模型；否则使用当前活跃模型。
    """
    # 如果指定了model_id，先切换
    if model_id is not None and model_id != _active_model_id:
        result = switch_model(model_id)
        if not result['success']:
            return {'error': result.get('error', '模型切换失败')}

    # 如果没有活跃模型，尝试自动选择第一个可用的
    if _active_model_id is None or _model_session is None:
        models = scan_models()
        available = [m for m in models if m['has_csv']]
        if not available:
            return {'error': '模型文件未找到。请将 .onnx + .csv 文件放入 models/ 目录。'}
        result = switch_model(available[0]['id'])
        if not result['success']:
            return {'error': result.get('error', '模型加载失败')}

    _load_model()

    input_tensor = _preprocess_image(image_bytes)
    input_name = _model_session.get_inputs()[0].name
    outputs = _model_session.run(None, {input_name: input_tensor})
    raw_output = outputs[0][0]

    # 判断是否需要sigmoid：看节点名 + 值域双重检测
    output_name = _model_session.get_outputs()[0].name.lower()
    needs_sigmoid = 'sigmoid' not in output_name

    # 进一步验证：如果输出值已全在[0,1]内，说明模型内置了sigmoid
    if needs_sigmoid:
        max_val = float(np.max(raw_output))
        min_val = float(np.min(raw_output))
        if max_val <= 1.0 and min_val >= 0.0:
            needs_sigmoid = False

    probabilities = 1.0 / (1.0 + np.exp(-raw_output)) if needs_sigmoid else raw_output

    results = {name: [] for name in CATEGORY_NAMES.values()}
    for i, prob in enumerate(probabilities):
        if i >= len(_all_tags):
            break
        confidence = float(prob)
        if confidence < threshold:
            continue
        tag_info = _all_tags[i]
        cat_name = CATEGORY_NAMES.get(tag_info['category'], 'general')
        results[cat_name].append({'name': tag_info['name'], 'confidence': round(confidence, 4)})

    for cat in results:
        results[cat].sort(key=lambda x: x['confidence'], reverse=True)

    return results


def get_status():
    """返回当前模型和全局状态"""
    models = scan_models()
    active_id = _active_model_id
    model_info = None
    for m in models:
        if m['id'] == active_id:
            model_info = m
            break

    return {
        'available': any(m['has_csv'] for m in models),
        'loaded': _model_session is not None,
        'active_model': active_id,
        'active_model_name': model_info['name'] if model_info else None,
        'tag_count': len(_all_tags) if _all_tags else 0,
        'models': models,
    }
