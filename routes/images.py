import os
from flask import Blueprint, request, jsonify, send_file, current_app
from utils import (
    get_image_files, get_caption_path, read_caption, write_caption,
    parse_tags, format_tags, get_image_dimensions, natural_key, safe_join
)
from database import get_image_rating, update_duplicate_groups, update_similar_pairs
import sqlite3
from database import _get_db as get_db

images_bp = Blueprint('images', __name__, url_prefix='/api')
images_bp.context = None

def _get_context():
    return images_bp.context

@images_bp.route('/get-images', methods=['POST'])
def get_images():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    selected_tags = data.get('tags', [])
    image_files = get_image_files(context.current_dataset_path)

    with sqlite3.connect(get_db().db_path) as conn:
        c = conn.cursor()
        c.execute(
            'SELECT DISTINCT filename1 FROM similar_pairs WHERE dataset_path=? UNION SELECT DISTINCT filename2 FROM similar_pairs WHERE dataset_path=?',
            (context.current_dataset_path, context.current_dataset_path))
        dup_files = set(row[0] for row in c.fetchall())

    result = []
    for img in image_files:
        txt_path = get_caption_path(os.path.join(context.current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = set(parse_tags(caption))
        if selected_tags:
            if not all(tag in tags for tag in selected_tags):
                continue
        img_path_full = os.path.join(context.current_dataset_path, img)
        try:
            w, h = get_image_dimensions(img_path_full)
            mtime = os.path.getmtime(img_path_full)
        except:
            w, h = 0, 0
            mtime = 0
        rating = get_image_rating(context.current_dataset_path, img) or 'general'
        result.append({
            'filename': img,
            'tag_count': len(tags),
            'width': w,
            'height': h,
            'rating': rating,
            'mtime': mtime,
            'has_duplicate': img in dup_files
        })
    return jsonify(result)

@images_bp.route('/thumbnail/<path:filename>')
def serve_thumbnail(filename):
    context = _get_context()
    if not context.current_dataset_path:
        return 'Dataset not loaded', 404
    safe_path = os.path.join(context.current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(context.current_dataset_path)):
        return 'Access denied', 403
    if not os.path.isfile(safe_path):
        return 'File not found', 404

    from PIL import Image
    import io

    img = Image.open(safe_path)
    img.thumbnail((450, 450), Image.Resampling.LANCZOS)

    img_io = io.BytesIO()
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img.save(img_io, format='PNG')
        mimetype = 'image/png'
    else:
        img.save(img_io, format='JPEG', quality=85, optimize=True)
        mimetype = 'image/jpeg'

    img_io.seek(0)
    response = send_file(img_io, mimetype=mimetype)
    response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
    return response

@images_bp.route('/image/<path:filename>')
def serve_image(filename):
    context = _get_context()
    if not context.current_dataset_path:
        return 'Dataset not loaded', 404
    safe_path = os.path.join(context.current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(context.current_dataset_path)):
        return 'Access denied', 403
    if not os.path.isfile(safe_path):
        return 'File not found', 404
    response = send_file(safe_path)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@images_bp.route('/get-caption', methods=['POST'])
def get_caption():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    txt_path = get_caption_path(os.path.join(context.current_dataset_path, filename))
    caption = read_caption(txt_path)
    return jsonify({'caption': caption})

@images_bp.route('/update-caption', methods=['POST'])
def update_caption():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    caption = data.get('caption', '')
    txt_path = get_caption_path(os.path.join(context.current_dataset_path, filename))
    write_caption(txt_path, caption)
    return jsonify({'success': True})

@images_bp.route('/bulk-rename', methods=['POST'])
def bulk_rename():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400

    data = request.get_json() or {}
    current_relative_path = data.get('path', '')

    try:
        if current_relative_path:
            working_dir = safe_join(context.current_dataset_path, current_relative_path)
        else:
            working_dir = context.current_dataset_path

        if not os.path.isdir(working_dir):
            return jsonify({'error': 'Папка не найдена'}), 400

        image_extensions = ('.jpg', '.jpeg', '.png', '.webp')
        all_images = [f for f in os.listdir(working_dir) if f.lower().endswith(image_extensions)]
        all_images.sort(key=natural_key)

        if not all_images:
            return jsonify({'error': 'Нет изображений для переименования'}), 400

        temp_names = {}
        for idx, old_name in enumerate(all_images, start=1):
            base, ext = os.path.splitext(old_name)
            temp_name = f"__temp_bulk_{idx}_{old_name}"
            old_path = os.path.join(working_dir, old_name)
            temp_path = os.path.join(working_dir, temp_name)
            os.rename(old_path, temp_path)
            temp_names[old_name] = temp_name

            old_txt_path = os.path.join(working_dir, base + '.txt')
            temp_txt_path = os.path.join(working_dir, os.path.splitext(temp_name)[0] + '.txt')
            if os.path.exists(old_txt_path):
                os.rename(old_txt_path, temp_txt_path)

        db = get_db()
        with sqlite3.connect(db.db_path) as conn:
            cursor = conn.cursor()
            for old_name, temp_name in temp_names.items():
                cursor.execute(
                    'UPDATE image_quality SET filename=? WHERE dataset_path=? AND filename=?',
                    (temp_name, working_dir, old_name)
                )
                cursor.execute(
                    'UPDATE image_ratings SET filename=? WHERE dataset_path=? AND filename=?',
                    (temp_name, working_dir, old_name)
                )
            cursor.execute('DELETE FROM duplicate_groups WHERE dataset_path=?', (working_dir,))
            cursor.execute('DELETE FROM similar_pairs WHERE dataset_path=?', (working_dir,))
            conn.commit()

        rename_map = []
        final_names_set = set()

        for idx, old_name in enumerate(all_images, start=1):
            base, ext = os.path.splitext(old_name)
            final_name = f"{idx}{ext}"
            temp_name = temp_names[old_name]
            temp_path = os.path.join(working_dir, temp_name)
            final_path = os.path.join(working_dir, final_name)

            original_final_name = final_name
            counter = 1
            while os.path.exists(final_path) and final_path != temp_path:
                final_name = f"{idx}_{counter}{ext}"
                final_path = os.path.join(working_dir, final_name)
                counter += 1

            os.rename(temp_path, final_path)

            temp_txt_path = os.path.join(working_dir, os.path.splitext(temp_name)[0] + '.txt')
            final_txt_path = os.path.join(working_dir, os.path.splitext(final_name)[0] + '.txt')
            if os.path.exists(temp_txt_path):
                if os.path.exists(final_txt_path):
                    txt_counter = 1
                    while True:
                        candidate_txt = os.path.join(working_dir, f"{os.path.splitext(final_name)[0]}_{txt_counter}.txt")
                        if not os.path.exists(candidate_txt):
                            final_txt_path = candidate_txt
                            break
                        txt_counter += 1
                os.rename(temp_txt_path, final_txt_path)

            rename_map.append((old_name, final_name, temp_name))
            final_names_set.add(final_name)

        with sqlite3.connect(db.db_path) as conn:
            cursor = conn.cursor()

            for _, final_name, _ in rename_map:
                cursor.execute(
                    'DELETE FROM image_quality WHERE dataset_path=? AND filename=?',
                    (working_dir, final_name)
                )
                cursor.execute(
                    'DELETE FROM image_ratings WHERE dataset_path=? AND filename=?',
                    (working_dir, final_name)
                )

            for _, final_name, temp_name in rename_map:
                cursor.execute(
                    'UPDATE image_quality SET filename=? WHERE dataset_path=? AND filename=?',
                    (final_name, working_dir, temp_name)
                )
                cursor.execute(
                    'UPDATE image_ratings SET filename=? WHERE dataset_path=? AND filename=?',
                    (final_name, working_dir, temp_name)
                )

            conn.commit()

        update_duplicate_groups(working_dir)
        update_similar_pairs(working_dir)

        return jsonify({'success': True, 'renamed': len(rename_map)})

    except Exception as error:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(error)}), 500

@images_bp.route('/bulk-delete-tags', methods=['POST'])
def bulk_delete_tags():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    tags_to_delete = data.get('tags', [])
    if not tags_to_delete:
        return jsonify({'error': 'Нет тегов для удаления'}), 400
    images = get_image_files(context.current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(context.current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = [t for t in tags if t not in tags_to_delete]
        if len(new_tags) != len(tags):
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@images_bp.route('/bulk-add-tags', methods=['POST'])
def bulk_add_tags():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    tags_to_add = data.get('tags', [])
    position = data.get('position', 'end')
    if not tags_to_add:
        return jsonify({'error': 'Нет тегов для добавления'}), 400
    images = get_image_files(context.current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(context.current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = tags[:]
        for tag in tags_to_add:
            if tag not in tags:
                if position == 'start':
                    new_tags.insert(0, tag)
                else:
                    new_tags.append(tag)
        if new_tags != tags:
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@images_bp.route('/bulk-replace-tag', methods=['POST'])
def bulk_replace_tag():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    old_tag = data.get('old_tag', '').strip()
    new_tag = data.get('new_tag', '').strip()
    if not old_tag or not new_tag:
        return jsonify({'error': 'Укажите оба тега'}), 400
    images = get_image_files(context.current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(context.current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = [new_tag if t == old_tag else t for t in tags]
        if new_tags != tags:
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@images_bp.route('/delete-image', methods=['POST'])
def delete_image():
    context = _get_context()
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'Filename required'}), 400

    safe_path = os.path.join(context.current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(context.current_dataset_path)):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.isfile(safe_path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.remove(safe_path)
        txt_path = get_caption_path(safe_path)
        if os.path.exists(txt_path):
            os.remove(txt_path)
        db = get_db()
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            c.execute('DELETE FROM image_ratings WHERE dataset_path=? AND filename=?',
                      (context.current_dataset_path, filename))
            conn.commit()
        db.delete_image_quality(context.current_dataset_path, filename)
        from database import remove_from_duplicate_groups, remove_from_similar_pairs
        remove_from_duplicate_groups(context.current_dataset_path, filename)
        remove_from_similar_pairs(context.current_dataset_path, filename)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500