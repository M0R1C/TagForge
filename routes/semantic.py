import os
from flask import Blueprint, request, jsonify
from semantic_filter import SemanticFilter
import io
from PIL import Image
from werkzeug.utils import secure_filename
import shutil
import torch

semantic_bp = Blueprint('semantic', __name__, url_prefix='/api')
semantic_bp.context = None

def _get_context():
    return semantic_bp.context

def _get_semantic_filter():
    context = _get_context()
    if context.semantic.semantic_filter is None:
        context.semantic.semantic_filter = SemanticFilter(models_dir='models')
    return context.semantic.semantic_filter

def validate_image_from_bytes(image_bytes):
    try:
        test_image = Image.open(io.BytesIO(image_bytes))
        test_image.verify()
        return True
    except Exception:
        return False

def save_uploaded_file(uploaded_file, destination_directory):
    original_filename = uploaded_file.filename
    safe_filename = secure_filename(original_filename)
    if not safe_filename:
        safe_filename = "unknown_file"
    file_bytes = uploaded_file.read()
    if not file_bytes:
        return None
    if not validate_image_from_bytes(file_bytes):
        return None
    target_path = os.path.join(destination_directory, safe_filename)
    with open(target_path, 'wb') as destination_file:
        destination_file.write(file_bytes)
    try:
        with Image.open(target_path) as test_image:
            test_image.verify()
        return target_path
    except Exception:
        if os.path.exists(target_path):
            os.remove(target_path)
        return None

@semantic_bp.route('/semantic/user-models', methods=['GET'])
def get_user_models():
    encoder = request.args.get('encoder')
    model_name = request.args.get('model_name')
    target_type = request.args.get('target_type')
    sf = _get_semantic_filter()
    models = sf.list_user_models(encoder=encoder, model_name=model_name, target_type=target_type)
    return jsonify(models)

@semantic_bp.route('/semantic/train', methods=['POST'])
def train_semantic_model():
    if 'good' not in request.files or 'bad' not in request.files:
        return jsonify({'error': 'Необходимо загрузить хорошие и плохие изображения'}), 400

    good_files = request.files.getlist('good')
    bad_files = request.files.getlist('bad')
    encoder = request.form.get('encoder', 'clip')
    model_name = request.form.get('model_name')
    target_type = request.form.get('target_type')
    user_model_name = request.form.get('user_model_name')

    if not encoder or not target_type or not user_model_name:
        return jsonify({'error': 'Не указаны encoder, target_type или user_model_name'}), 400

    if not good_files or not bad_files:
        return jsonify({'error': 'Необходимо загрузить хотя бы одно хорошее и одно плохое изображение'}), 400

    from utils import get_app_temp_dir
    import tempfile
    temp_root = get_app_temp_dir()
    tmp_dir = tempfile.mkdtemp(dir=temp_root)

    good_paths = []
    bad_paths = []

    import io
    from PIL import Image
    from werkzeug.utils import secure_filename

    def is_valid_image_bytes(data_bytes):
        try:
            img = Image.open(io.BytesIO(data_bytes))
            img.verify()
            return True
        except Exception:
            return False

    def save_uploaded_file(uploaded_file, dest_dir):
        original_name = uploaded_file.filename
        safe_name = secure_filename(original_name) or "image"
        file_bytes = uploaded_file.read()
        if not file_bytes or not is_valid_image_bytes(file_bytes):
            return None
        dest_path = os.path.join(dest_dir, safe_name)
        with open(dest_path, 'wb') as f:
            f.write(file_bytes)
        try:
            with Image.open(dest_path) as img:
                img.verify()
            return dest_path
        except Exception:
            if os.path.exists(dest_path):
                os.remove(dest_path)
            return None

    for f in good_files:
        path = save_uploaded_file(f, tmp_dir)
        if path:
            good_paths.append(path)

    for f in bad_files:
        path = save_uploaded_file(f, tmp_dir)
        if path:
            bad_paths.append(path)

    if len(good_paths) == 0 or len(bad_paths) == 0:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return jsonify({'error': 'Не удалось сохранить или проверить изображения. Убедитесь, что все файлы — корректные изображения.'}), 400

    sf = None
    try:
        sf = _get_semantic_filter()
        model_id = sf.train_classifier(
            good_paths, bad_paths,
            encoder=encoder,
            model_name=model_name,
            target_type=target_type,
            user_model_name=user_model_name
        )
        return jsonify({'success': True, 'model_id': model_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        if sf is not None:
            sf.unload_all()
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

@semantic_bp.route('/semantic/start', methods=['POST'])
def semantic_start():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400

    data = request.get_json()
    detectors = data.get('detectors', [])
    yolo_models = data.get('yolo_models', {})
    yolo_thresholds = data.get('yolo_thresholds', {})
    encoder = data.get('encoder')
    encoder_model = data.get('encoder_model')
    user_model_id = data.get('user_model_id')
    clip_uncertainty_margin = data.get('clip_uncertainty_margin', 0.1)
    thresholds = data.get('thresholds', {'auto': 0.85, 'suspicious': 0.70})
    auto_tagger_model = data.get('auto_tagger_model')
    auto_tagger_threshold = data.get('auto_tagger_threshold', 0.35)

    user_model_data = None
    if user_model_id:
        try:
            user_model_data = _get_semantic_filter().load_user_model_by_id(user_model_id)
        except Exception as e:
            return jsonify({'error': f'Не удалось загрузить модель пользователя: {e}'}), 400

    user_models_per_detector = {}
    for det in ['hands_yolo', 'face_yolo', 'eyes_yolo', 'feet_yolo']:
        model_id = data.get(f'user_model_{det}')
        if model_id:
            try:
                user_models_per_detector[det] = _get_semantic_filter().load_user_model_by_id(model_id)
            except Exception:
                pass

    config = {
        'detectors': detectors,
        'yolo_models': yolo_models,
        'yolo_thresholds': yolo_thresholds,
        'encoder': encoder,
        'encoder_model': encoder_model,
        'user_model_data': user_model_data,
        'user_models_per_detector': user_models_per_detector,
        'thresholds': thresholds,
        'auto_tagger_model': auto_tagger_model,
        'auto_tagger_threshold': auto_tagger_threshold,
        'clip_uncertainty_margin': clip_uncertainty_margin
    }
    context.semantic.start(context.current_dataset_path, config)
    return jsonify({'success': True})

@semantic_bp.route('/semantic/status', methods=['GET'])
def semantic_status():
    context = _get_context()
    status = context.semantic.get_status()
    return jsonify({
        'running': status.get('running', False),
        'total': status.get('total', 0),
        'processed': status.get('processed', 0),
        'current_file': status.get('current_file', ''),
        'suspicious_count': status.get('suspicious_count', 0),
        'bad_count': status.get('bad_count', 0)
    })

@semantic_bp.route('/semantic/suspicious', methods=['GET'])
def get_suspicious():
    context = _get_context()
    return jsonify(context.semantic.get_suspicious())

@semantic_bp.route('/semantic/stop', methods=['POST'])
def semantic_stop():
    context = _get_context()
    if not context.semantic.is_running:
        return jsonify({'error': 'Фильтрация не выполняется'}), 400
    context.semantic.stop()
    return jsonify({'success': True})

@semantic_bp.route('/semantic/mark-bad', methods=['POST'])
def mark_bad():
    context = _get_context()
    data = request.get_json()
    filename = data.get('filename')
    if not filename or not context.current_dataset_path:
        return jsonify({'error': 'Некорректный запрос'}), 400
    import shutil
    bad_dir = os.path.join(context.current_dataset_path, 'marked_as_bad')
    os.makedirs(bad_dir, exist_ok=True)
    src = os.path.join(context.current_dataset_path, filename)
    dst = os.path.join(bad_dir, filename)
    try:
        shutil.move(src, dst)
        from utils import get_caption_path
        txt_src = get_caption_path(src)
        txt_dst = get_caption_path(dst)
        if os.path.exists(txt_src):
            shutil.move(txt_src, txt_dst)
        from database import delete_image_quality, remove_from_duplicate_groups, remove_from_similar_pairs
        delete_image_quality(context.current_dataset_path, filename)
        import sqlite3
        from database import _get_db
        db = _get_db()
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            c.execute('DELETE FROM image_ratings WHERE dataset_path=? AND filename=?', (context.current_dataset_path, filename))
            conn.commit()
        remove_from_duplicate_groups(context.current_dataset_path, filename)
        remove_from_similar_pairs(context.current_dataset_path, filename)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@semantic_bp.route('/semantic/mark-good', methods=['POST'])
def mark_good():
    return jsonify({'success': True})

@semantic_bp.route('/semantic/clip-models', methods=['GET'])
def get_clip_models():
    from app_context import BASE_DIR
    clip_dir = os.path.join(BASE_DIR, 'models', 'clip')
    models = []
    if os.path.isdir(clip_dir):
        for item in os.listdir(clip_dir):
            if os.path.isdir(os.path.join(clip_dir, item)) or item.endswith(('.bin', '.pt', '.pth')):
                models.append(item)
    return jsonify(models)

@semantic_bp.route('/semantic/dinov2-models', methods=['GET'])
def get_dinov2_models():
    from app_context import BASE_DIR
    dinov2_dir = os.path.join(BASE_DIR, 'models', 'dinov2')
    models = []
    if os.path.isdir(dinov2_dir):
        for item in os.listdir(dinov2_dir):
            if os.path.isdir(os.path.join(dinov2_dir, item)) or item.endswith(('.bin', '.pt', '.pth')):
                models.append(item)
    return jsonify(models)

@semantic_bp.route('/semantic/yolo-models', methods=['GET'])
def get_yolo_models():
    from app_context import BASE_DIR
    yolo_models = []
    yolo_dir = os.path.join(BASE_DIR, 'models', 'yolo')
    if os.path.isdir(yolo_dir):
        yolo_models.extend([f for f in os.listdir(yolo_dir) if f.endswith(('.pt', '.pth'))])
    models_dir = os.path.join(BASE_DIR, 'models')
    if os.path.isdir(models_dir):
        for f in os.listdir(models_dir):
            if f.endswith(('.pt', '.pth')) and f not in yolo_models:
                yolo_models.append(f)
    if not yolo_models:
        yolo_models.append('yolov8n.pt')
    return jsonify(yolo_models)