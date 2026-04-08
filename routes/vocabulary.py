import os
import json
from flask import Blueprint, request, jsonify
from collections import OrderedDict
from database import get_dataset_vocabulary, save_dataset_vocabulary

vocabulary_bp = Blueprint('vocabulary', __name__, url_prefix='/api')
vocabulary_bp.context = None

def _get_context():
    return vocabulary_bp.context

@vocabulary_bp.route('/vocabulary/<path:dataset_path>', methods=['GET'])
def get_vocabulary(dataset_path):
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Dataset path does not exist'}), 404
    content_json = get_dataset_vocabulary(dataset_path)
    if content_json:
        return jsonify({'content': json.loads(content_json)})
    else:
        fallback = OrderedDict([
            ("Trigger_words", ["example_trigger word", "another_example"]),
            ("Default outfit", ["example_outfit word", "another_example"]),
            ("Optional", ["example_optional word", "another_example"])
        ])
        return jsonify({'content': fallback})

@vocabulary_bp.route('/vocabulary/<path:dataset_path>', methods=['POST'])
def save_vocabulary(dataset_path):
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Dataset path does not exist'}), 404
    data = request.get_json()
    content = data.get('content')
    if content is None:
        return jsonify({'error': 'Missing content'}), 400
    save_dataset_vocabulary(dataset_path, json.dumps(content))
    return jsonify({'success': True})