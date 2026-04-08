from flask import Blueprint, request, jsonify
from database import get_all_flags, add_flag, delete_flag, rename_flag

flags_bp = Blueprint('flags', __name__, url_prefix='/api')
flags_bp.context = None

def _get_context():
    return flags_bp.context

@flags_bp.route('/flags', methods=['GET'])
def get_flags():
    return jsonify(get_all_flags())

@flags_bp.route('/flags', methods=['POST'])
def create_flag():
    data = request.get_json()
    name = data.get('name')
    color = data.get('color', '#3b82f6')
    if not name:
        return jsonify({'error': 'Имя флага обязательно'}), 400
    add_flag(name, color)
    return jsonify({'success': True})

@flags_bp.route('/flags/<name>', methods=['PUT'])
def update_flag(name):
    data = request.get_json()
    new_name = data.get('name')
    new_color = data.get('color')
    if not new_name:
        return jsonify({'error': 'Новое имя обязательно'}), 400
    rename_flag(name, new_name, new_color)
    return jsonify({'success': True})

@flags_bp.route('/flags/<name>', methods=['DELETE'])
def remove_flag(name):
    delete_flag(name)
    return jsonify({'success': True})