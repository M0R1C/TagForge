from flask import Blueprint, request, jsonify

backup_bp = Blueprint('backup', __name__, url_prefix='/api')
backup_bp.context = None

def _get_context():
    return backup_bp.context

@backup_bp.route('/backup/start', methods=['POST'])
def backup_start():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    if context.backup.is_running:
        return jsonify({'error': 'Бэкап уже выполняется'}), 400
    context.backup.start(context.current_dataset_path)
    return jsonify({'success': True})

@backup_bp.route('/backup/status', methods=['GET'])
def backup_status():
    context = _get_context()
    return jsonify(context.backup.get_status())

@backup_bp.route('/backup/stop', methods=['POST'])
def backup_stop():
    context = _get_context()
    context.backup.stop()
    return jsonify({'success': True})