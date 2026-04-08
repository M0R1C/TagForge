import os
from flask import Blueprint, request, jsonify

crop_bp = Blueprint('crop', __name__, url_prefix='/api')
crop_bp.context = None

def _get_context():
    return crop_bp.context

@crop_bp.route('/auto-crop/start', methods=['POST'])
def auto_crop_start():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    folder = data.get('folder', '').strip()
    model = data.get('model', '').strip()
    threshold = data.get('threshold', 0.5)
    if not folder or not model:
        return jsonify({'error': 'Не указана папка или модель'}), 400
    from app_context import BASE_DIR
    yolo_dir = os.path.join(BASE_DIR, 'models', 'yolo')
    available_models = []
    if os.path.isdir(yolo_dir):
        available_models = [f for f in os.listdir(yolo_dir) if f.endswith(('.pt', '.pth'))]
    if model not in available_models:
        return jsonify({'error': f'Модель "{model}" не найдена'}), 400

    if context.crop.is_running:
        return jsonify({'error': 'Кроппинг уже выполняется'}), 400

    context.crop.start(context.current_dataset_path, folder, model, threshold)
    return jsonify({'success': True})

@crop_bp.route('/auto-crop/status', methods=['GET'])
def auto_crop_status():
    context = _get_context()
    return jsonify(context.crop.get_status())

@crop_bp.route('/auto-crop/stop', methods=['POST'])
def auto_crop_stop():
    context = _get_context()
    context.crop.stop()
    return jsonify({'success': True})