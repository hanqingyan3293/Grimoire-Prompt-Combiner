#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Controlled local WD14 worker for the Grimoire desktop application."""

import base64
import hashlib
import hmac
import io
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from wd14_tagger import get_status, predict, scan_models, switch_model

TOKEN = os.environ.get('GRIMOIRE_WD14_TOKEN', '')
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_JSON_BYTES = 140 * 1024 * 1024


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


class Handler(BaseHTTPRequestHandler):
    server_version = 'GrimoireWD14/1'

    def log_message(self, format, *args):
        # Keep stdout machine-readable for the Electron process manager.
        return

    def do_GET(self):
        if not authorized(self):
            json_response(self, 401, {'error': 'unauthorized'})
            return
        path = urlparse(self.path).path
        if path == '/health':
            json_response(self, 200, {'ok': True, 'service': 'wd14'})
        elif path == '/models':
            json_response(self, 200, {'models': scan_models()})
        elif path == '/status':
            json_response(self, 200, get_status())
        else:
            json_response(self, 404, {'error': 'not_found'})

    def do_POST(self):
        if not authorized(self):
            json_response(self, 401, {'error': 'unauthorized'})
            return
        path = urlparse(self.path).path
        if path == '/switch':
            self.handle_switch()
        elif path == '/tag':
            self.handle_tag()
        else:
            json_response(self, 404, {'error': 'not_found'})

    def read_json(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > MAX_JSON_BYTES:
            raise ValueError('invalid request size')
        return json.loads(self.rfile.read(length).decode('utf-8'))

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

    def handle_tag(self):
        try:
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('application/json'):
                raise ValueError('JSON request required')
            body = self.read_json()
            image_b64 = body.get('image_base64') if isinstance(body, dict) else None
            if not isinstance(image_b64, str) or not image_b64:
                raise ValueError('image_base64 is required')
            image_bytes = base64.b64decode(image_b64, validate=True)
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ValueError('image size is invalid')
            threshold = body.get('threshold', 0.35)
            if not isinstance(threshold, (int, float)):
                raise ValueError('threshold is invalid')
            threshold = max(0.01, min(0.99, float(threshold)))
            model_id = body.get('model_id')
            if model_id is not None and not isinstance(model_id, str):
                raise ValueError('model_id is invalid')
            result = predict(image_bytes, threshold=threshold, model_id=model_id)
            json_response(self, 200 if 'error' not in result else 503, result)
        except Exception as error:
            json_response(self, 400, {'error': str(error)})


def main():
    port = int(os.environ.get('GRIMOIRE_WD14_PORT', '0'))
    if not TOKEN:
        raise RuntimeError('GRIMOIRE_WD14_TOKEN is required')
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(json.dumps({'ready': True, 'port': server.server_address[1]}, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
