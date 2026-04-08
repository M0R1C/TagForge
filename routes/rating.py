from flask import Blueprint, request, jsonify
from database import get_image_rating

rating_bp = Blueprint('rating', __name__, url_prefix='/api')
rating_bp.context = None

def _get_context():
    return rating_bp.context

@rating_bp.route('/rating-analysis/status', methods=['GET'])
def rating_status_api():
    context = _get_context()
    status = context.rating.get_status()
    status.pop('dataset_path', None)
    return jsonify(status)

@rating_bp.route('/image-rating/<path:filename>', methods=['GET'])
def get_image_rating_api(filename):
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    rating = get_image_rating(context.current_dataset_path, filename)
    if rating is None:
        rating = 'general'
    return jsonify({'rating': rating})