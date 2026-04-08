from flask import Blueprint, request, jsonify
from database import get_image_quality, update_duplicate_groups, update_similar_pairs, get_version_stats
import sqlite3
from database import _get_db as get_db
import os
import json

analysis_bp = Blueprint('analysis', __name__, url_prefix='/api')
analysis_bp.context = None

def _get_context():
    return analysis_bp.context

@analysis_bp.route('/analyze/start', methods=['POST'])
def analyze_start():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    if context.analysis.is_running:
        return jsonify({'error': 'Анализ уже выполняется'}), 400
    context.analysis.start(context.current_dataset_path)
    return jsonify({'success': True})

@analysis_bp.route('/analyze/status', methods=['GET'])
def analyze_status():
    context = _get_context()
    status = context.analysis.get_status()
    return jsonify(status)

@analysis_bp.route('/analyze/stop', methods=['POST'])
def analyze_stop():
    context = _get_context()
    if not context.analysis.is_running:
        return jsonify({'error': 'Анализ не выполняется'}), 400
    context.analysis.stop()
    return jsonify({'success': True, 'warning': 'Процессы остановки не поддерживаются, но статус сброшен'})

@analysis_bp.route('/duplicates', methods=['GET'])
def get_duplicates():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    db = get_db()
    with sqlite3.connect(db.db_path) as conn:
        c = conn.cursor()
        c.execute('''
            SELECT file_hash, files FROM duplicate_groups
            WHERE file_hash IN (SELECT file_hash FROM image_quality WHERE dataset_path=?)
        ''', (context.current_dataset_path,))
        rows = c.fetchall()
        groups = [{'hash': row[0], 'files': json.loads(row[1])} for row in rows]
    return jsonify(groups)

@analysis_bp.route('/similar/<filename>', methods=['GET'])
def get_similar(filename):
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    db = get_db()
    with sqlite3.connect(db.db_path) as conn:
        c = conn.cursor()
        c.execute('''
            SELECT filename2, similarity FROM similar_pairs
            WHERE dataset_path=? AND filename1=?
            UNION
            SELECT filename1, similarity FROM similar_pairs
            WHERE dataset_path=? AND filename2=?
        ''', (context.current_dataset_path, filename, context.current_dataset_path, filename))
        rows = c.fetchall()
        similar = [{'filename': row[0], 'similarity': row[1]} for row in rows]
    return jsonify(similar)

@analysis_bp.route('/image-quality/<path:filename>', methods=['GET'])
def get_image_quality_api(filename):
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    quality = get_image_quality(context.current_dataset_path, filename)
    if quality:
        return jsonify({
            'width': quality['width'],
            'height': quality['height'],
            'aspect_ratio': quality['aspect_ratio'],
            'multiple_32': bool(quality['multiple_32']),
            'multiple_64': bool(quality['multiple_64']),
            'overall_quality': quality['overall_quality'],
            'sharpness': quality['sharpness'],
            'jpeg_artifacts': quality['jpeg_artifacts'],
            'noise_level': quality['noise_level'],
            'resolution_score': quality['resolution_score']
        })
    else:
        return jsonify({})

@analysis_bp.route('/reset-ratings', methods=['POST'])
def reset_ratings():
    try:
        from database import clear_all_analysis_data
        clear_all_analysis_data()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@analysis_bp.route('/version-stats', methods=['GET'])
def version_stats():
    dataset_name = request.args.get('dataset')
    versions = request.args.getlist('versions')
    if not dataset_name or not versions:
        return jsonify({'error': 'Не указан датасет или версии'}), 400

    from utils import get_working_directory
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400

    dataset_path = os.path.join(wd, dataset_name)
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Датасет не найден'}), 404

    stats = {}
    for version in versions:
        version_full_path = os.path.join(dataset_path, version)
        if not os.path.isdir(version_full_path):
            stats[version] = {'error': 'Версия не найдена'}
        else:
            stats[version] = get_version_stats(version_full_path)
    return jsonify(stats)

@analysis_bp.route('/version-quality-check', methods=['GET'])
def version_quality_check():
    dataset_name = request.args.get('dataset')
    version = request.args.get('version')
    if not dataset_name or not version:
        return jsonify({'has_data': False})

    from utils import get_working_directory
    wd = get_working_directory()
    if not wd:
        return jsonify({'has_data': False})

    dataset_path = os.path.join(wd, dataset_name)
    version_full_path = os.path.join(dataset_path, version)

    if not os.path.isdir(version_full_path):
        return jsonify({'has_data': False})

    db = get_db()
    with sqlite3.connect(db.db_path) as conn:
        c = conn.cursor()
        c.execute('SELECT COUNT(*) FROM image_quality WHERE dataset_path=?', (version_full_path,))
        count = c.fetchone()[0]

    return jsonify({'has_data': count > 0})

@analysis_bp.route('/similar-pairs', methods=['GET'])
def get_similar_pairs():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    db = get_db()
    with sqlite3.connect(db.db_path) as conn:
        c = conn.cursor()
        c.execute('SELECT filename1, filename2, similarity FROM similar_pairs WHERE dataset_path=?', (context.current_dataset_path,))
        rows = c.fetchall()
        pairs = [{'filename1': row[0], 'filename2': row[1], 'similarity': row[2]} for row in rows]
    return jsonify(pairs)

@analysis_bp.route('/get-analysis', methods=['GET'])
def get_analysis():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    from utils import get_image_files, get_caption_path, read_caption, parse_tags, get_image_dimensions, get_aspect_ratio_label
    from database import get_all_ratings_for_dataset
    from collections import Counter

    images = get_image_files(context.current_dataset_path)
    rating_counts = {'general': 0, 'sensitive': 0, 'questionable': 0, 'explicit': 0}
    ratings_dict = get_all_ratings_for_dataset(context.current_dataset_path)
    resolution_counter = Counter()
    tag_counter = Counter()
    aspect_counter = Counter()
    good_for_training_count = 0
    total_tags_count = 0

    for img in images:
        rating = ratings_dict.get(img, 'general')
        if rating in rating_counts:
            rating_counts[rating] += 1
        else:
            rating_counts['general'] += 1

        txt_path = get_caption_path(os.path.join(context.current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        tag_counter.update(tags)
        total_tags_count += len(tags)

        img_path_full = os.path.join(context.current_dataset_path, img)
        try:
            w, h = get_image_dimensions(img_path_full)
            resolution_counter[f"{w}x{h}"] += 1
            aspect = get_aspect_ratio_label(w, h)
            aspect_counter[aspect] += 1
            if (w % 32 == 0 and h % 32 == 0) or (w % 64 == 0 and h % 64 == 0):
                good_for_training_count += 1
        except:
            pass

    top_tags = [{'tag': tag, 'count': count} for tag, count in tag_counter.most_common(20)]
    predominant_aspect = aspect_counter.most_common(1)[0][0] if aspect_counter else 'N/A'
    total_images = len(images)
    good_percent = round((good_for_training_count / total_images * 100), 1) if total_images else 0

    return jsonify({
        'ratings': rating_counts,
        'resolutions': [{'resolution': res, 'count': cnt} for res, cnt in resolution_counter.items()],
        'top_tags': top_tags,
        'total_images': total_images,
        'unique_tags': len(tag_counter),
        'avg_tags_per_image': round(total_tags_count / total_images, 1) if total_images else 0,
        'predominant_aspect': predominant_aspect,
        'good_for_training_count': good_for_training_count,
        'good_for_training_percent': good_percent
    })

@analysis_bp.route('/widget-layout', methods=['GET'])
def get_widget_layout_api():
    from database import get_global_widget_layout
    import json
    layout_json = get_global_widget_layout()
    if layout_json:
        return jsonify({'layout': json.loads(layout_json)})
    else:
        return jsonify({'layout': []})

@analysis_bp.route('/widget-layout', methods=['POST'])
def save_widget_layout_api():
    from database import save_global_widget_layout
    data = request.get_json()
    layout = data.get('layout')
    if layout is None:
        return jsonify({'error': 'layout required'}), 400
    save_global_widget_layout(json.dumps(layout))
    return jsonify({'success': True})