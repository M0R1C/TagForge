from flask import Blueprint, request, jsonify

auto_tag_bp = Blueprint('auto_tag', __name__, url_prefix='/api')
auto_tag_bp.context = None

def _get_context():
    return auto_tag_bp.context

@auto_tag_bp.route('/auto-models', methods=['GET'])
def auto_models():
    context = _get_context()
    models = context.tagger.list_models()
    return jsonify(models)

@auto_tag_bp.route('/auto-tag/start', methods=['POST'])
def auto_tag_start():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    if context.auto_tag.is_running:
        return jsonify({'error': 'Процесс уже запущен'}), 400
    data = request.get_json()
    model = data.get('model')
    threshold = data.get('threshold', 0.35)
    mode = data.get('mode', 'append')
    if not model:
        return jsonify({'error': 'Модель не выбрана'}), 400
    available_models = context.tagger.list_models()
    if model not in available_models:
        return jsonify({'error': f'Модель "{model}" не найдена'}), 400
    context.auto_tag.start(context.current_dataset_path, model, threshold, mode)
    return jsonify({'success': True})

@auto_tag_bp.route('/auto-tag/status', methods=['GET'])
def auto_tag_status():
    context = _get_context()
    return jsonify(context.auto_tag.get_status())

@auto_tag_bp.route('/auto-tag/stop', methods=['POST'])
def auto_tag_stop():
    context = _get_context()
    context.auto_tag.stop()
    return jsonify({'success': True})