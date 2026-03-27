import sqlite3
import os
import json
from PIL import Image
from utils import get_image_files, get_caption_path, read_caption, parse_tags
import numpy as np

DB_PATH = os.path.join(os.path.dirname(__file__), 'dataset_editor.db')

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lang TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                UNIQUE(lang, key)
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS image_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_path TEXT NOT NULL,
                filename TEXT NOT NULL,
                rating TEXT NOT NULL,
                UNIQUE(dataset_path, filename)
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS dataset_flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#3b82f6',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS widget_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                layout TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute("PRAGMA table_info(image_ratings)")
        columns = [col[1] for col in c.fetchall()]
        if 'file_hash' not in columns:
            c.execute("ALTER TABLE image_ratings ADD COLUMN file_hash TEXT")
            conn.commit()
        c.execute('''
            CREATE TABLE IF NOT EXISTS dataset_vocabulary (
                dataset_path TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS image_quality (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_hash TEXT,
            perceptual_hash TEXT,
            width INTEGER,
            height INTEGER,
            aspect_ratio TEXT,
            multiple_32 BOOLEAN DEFAULT 0,
            multiple_64 BOOLEAN DEFAULT 0,
            resolution_score REAL DEFAULT 0,
            sharpness REAL DEFAULT 0,
            jpeg_artifacts REAL DEFAULT 0,
            noise_level REAL DEFAULT 0,
            has_watermark BOOLEAN DEFAULT 0,
            overall_quality REAL DEFAULT 0,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(dataset_path, filename)
            )
        ''')
        c.execute("PRAGMA table_info(image_quality)")
        columns = [col[1] for col in c.fetchall()]
        if 'overall_quality' not in columns:
            c.execute("ALTER TABLE image_quality ADD COLUMN overall_quality REAL DEFAULT 0")
        c.execute('''
            CREATE TABLE IF NOT EXISTS duplicate_groups (
                group_id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_path TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                files TEXT NOT NULL,  -- JSON массив имён файлов
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(dataset_path, file_hash)
                )
            ''')
        c.execute('''
                CREATE TABLE IF NOT EXISTS similar_pairs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dataset_path TEXT NOT NULL,
                    filename1 TEXT NOT NULL,
                    filename2 TEXT NOT NULL,
                    similarity REAL NOT NULL,  -- расстояние Хэмминга или процент
                    UNIQUE(dataset_path, filename1, filename2)
                )
            ''')
        conn.commit()

def save_image_quality(dataset_path, filename, metrics):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        overall = float(metrics.get('overall_quality', 0.0))
        c.execute('''
            INSERT OR REPLACE INTO image_quality
            (dataset_path, filename, file_hash, perceptual_hash, width, height,
             aspect_ratio, multiple_32, multiple_64, resolution_score, sharpness,
             jpeg_artifacts, noise_level, has_watermark, overall_quality, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (
            dataset_path, filename,
            metrics.get('file_hash'),
            metrics.get('perceptual_hash'),
            metrics.get('width'),
            metrics.get('height'),
            metrics.get('aspect_ratio'),
            metrics.get('multiple_32', False),
            metrics.get('multiple_64', False),
            float(metrics.get('resolution_score', 0.0)),
            float(metrics.get('sharpness', 0.0)),
            float(metrics.get('jpeg_artifacts', 0.0)),
            float(metrics.get('noise_level', 0.0)),
            metrics.get('has_watermark', False),
            overall
        ))
        conn.commit()

def get_image_quality(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM image_quality WHERE dataset_path=? AND filename=?', (dataset_path, filename))
        row = c.fetchone()
        if row:
            columns = [desc[0] for desc in c.description]
            return dict(zip(columns, row))
        return None

def delete_image_quality(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM image_quality WHERE dataset_path=? AND filename=?', (dataset_path, filename))
        conn.commit()

def update_duplicate_groups(dataset_path):
    print(f"update_duplicate_groups called for {dataset_path}")
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM duplicate_groups WHERE dataset_path=?', (dataset_path,))
        print(f"Deleted old duplicate groups for {dataset_path}")

        c.execute('''
            SELECT file_hash, filename FROM image_quality
            WHERE dataset_path=? AND file_hash IS NOT NULL
        ''', (dataset_path,))
        rows = c.fetchall()
        print(f"Found {len(rows)} image_quality records with file_hash")

        groups = {}
        for file_hash, filename in rows:
            groups.setdefault(file_hash, []).append(filename)

        inserted = 0
        for file_hash, files in groups.items():
            if len(files) > 1:
                files_json = json.dumps(files)
                c.execute('''
                    INSERT INTO duplicate_groups (dataset_path, file_hash, files, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ''', (dataset_path, file_hash, files_json))
                inserted += 1
        conn.commit()
        print(f"Inserted {inserted} duplicate groups")

def remove_from_duplicate_groups(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT file_hash FROM image_quality WHERE dataset_path=? AND filename=?', (dataset_path, filename))
        row = c.fetchone()
        if row and row[0]:
            file_hash = row[0]
            c.execute('SELECT files FROM duplicate_groups WHERE dataset_path=? AND file_hash=?', (dataset_path, file_hash))
            row2 = c.fetchone()
            if row2:
                files = json.loads(row2[0])
                if filename in files:
                    files.remove(filename)
                    if len(files) <= 1:
                        c.execute('DELETE FROM duplicate_groups WHERE dataset_path=? AND file_hash=?', (dataset_path, file_hash))
                    else:
                        c.execute('UPDATE duplicate_groups SET files=?, updated_at=CURRENT_TIMESTAMP WHERE dataset_path=? AND file_hash=?',
                                  (json.dumps(files), dataset_path, file_hash))
        conn.commit()

def remove_from_similar_pairs(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM similar_pairs WHERE dataset_path=? AND (filename1=? OR filename2=?)',
                  (dataset_path, filename, filename))
        conn.commit()

def rename_file_in_similar_pairs(dataset_path, old_filename, new_filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('UPDATE similar_pairs SET filename1 = ? WHERE dataset_path = ? AND filename1 = ?',
                  (new_filename, dataset_path, old_filename))
        c.execute('UPDATE similar_pairs SET filename2 = ? WHERE dataset_path = ? AND filename2 = ?',
                  (new_filename, dataset_path, old_filename))
        conn.commit()

def rename_file_in_duplicate_groups(dataset_path, old_filename, new_filename, file_hash):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT files FROM duplicate_groups WHERE dataset_path = ? AND file_hash = ?',
                  (dataset_path, file_hash))
        row = c.fetchone()
        if row:
            files = json.loads(row[0])
            if old_filename in files:
                files[files.index(old_filename)] = new_filename
                c.execute('UPDATE duplicate_groups SET files = ?, updated_at = CURRENT_TIMESTAMP WHERE dataset_path = ? AND file_hash = ?',
                          (json.dumps(files), dataset_path, file_hash))
                conn.commit()

def rename_folder_prefix_in_db(old_prefix, new_prefix):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        for table in ('image_quality', 'image_ratings', 'similar_pairs', 'duplicate_groups'):
            c.execute(f'SELECT DISTINCT dataset_path FROM {table} WHERE dataset_path LIKE ?', (old_prefix + '%',))
            rows = c.fetchall()
            for (old_path,) in rows:
                new_path = new_prefix + old_path[len(old_prefix):]
                c.execute(f'UPDATE {table} SET dataset_path = ? WHERE dataset_path = ?', (new_path, old_path))
        conn.commit()

def rename_folder_prefix_in_quality_and_ratings(dataset_path, old_prefix, new_prefix):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT filename FROM image_quality WHERE dataset_path = ? AND filename LIKE ?',
                  (dataset_path, old_prefix + '%'))
        rows = c.fetchall()
        for (old_name,) in rows:
            new_name = new_prefix + old_name[len(old_prefix):]
            c.execute('UPDATE image_quality SET filename = ? WHERE dataset_path = ? AND filename = ?',
                      (new_name, dataset_path, old_name))
        c.execute('SELECT filename FROM image_ratings WHERE dataset_path = ? AND filename LIKE ?',
                  (dataset_path, old_prefix + '%'))
        rows = c.fetchall()
        for (old_name,) in rows:
            new_name = new_prefix + old_name[len(old_prefix):]
            c.execute('UPDATE image_ratings SET filename = ? WHERE dataset_path = ? AND filename = ?',
                      (new_name, dataset_path, old_name))
        conn.commit()

def update_similar_pairs(dataset_path, threshold=15):
    print(f"update_similar_pairs called for {dataset_path}")
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            SELECT filename, perceptual_hash FROM image_quality
            WHERE dataset_path=? AND perceptual_hash IS NOT NULL
        ''', (dataset_path,))
        rows = c.fetchall()
        print(f"Found {len(rows)} records with perceptual_hash")

        c.execute('DELETE FROM similar_pairs WHERE dataset_path=?', (dataset_path,))
        print(f"Deleted old similar pairs for {dataset_path}")

        if not rows:
            return

        max_possible = len(rows[0][1]) * 4
        inserted = 0
        for i, (f1, h1) in enumerate(rows):
            for j, (f2, h2) in enumerate(rows[i+1:], i+1):
                if h1 and h2:
                    try:
                        h1_int = int(h1, 16)
                        h2_int = int(h2, 16)
                        distance = bin(h1_int ^ h2_int).count('1')
                    except:
                        distance = max_possible

                    if distance <= threshold:
                        similarity = 1.0 - distance / max_possible
                        c.execute('''
                            INSERT OR REPLACE INTO similar_pairs
                            (dataset_path, filename1, filename2, similarity)
                            VALUES (?, ?, ?, ?)
                        ''', (dataset_path, f1, f2, similarity))
                        inserted += 1
        conn.commit()
        print(f"Inserted {inserted} similar pairs")

def get_translation(lang, key):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM translations WHERE lang=? AND key=?', (lang, key))
        row = c.fetchone()
        return row[0] if row else key

def get_all_translations(lang):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM translations WHERE lang=?', (lang,))
        return dict(c.fetchall())

def get_all_flags():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT name, color FROM dataset_flags ORDER BY name')
        return [{'name': row[0], 'color': row[1]} for row in c.fetchall()]

def add_flag(name, color):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('INSERT OR IGNORE INTO dataset_flags (name, color) VALUES (?, ?)', (name, color))
        conn.commit()

def delete_flag(name):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM dataset_flags WHERE name = ?', (name,))
        conn.commit()

def rename_flag(old_name, new_name, new_color):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('UPDATE dataset_flags SET name = ?, color = ? WHERE name = ?', (new_name, new_color, old_name))
        conn.commit()

def get_setting(key, default=None):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM settings WHERE key=?', (key,))
        row = c.fetchone()
        return row[0] if row else default

def set_setting(key, value):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('REPLACE INTO settings (key, value) VALUES (?,?)', (key, value))
        conn.commit()

def save_global_widget_layout(layout_json):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM widget_layouts')
        c.execute('''
            INSERT INTO widget_layouts (layout, updated_at)
            VALUES (?, CURRENT_TIMESTAMP)
        ''', (layout_json,))
        conn.commit()

def get_global_widget_layout():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT layout FROM widget_layouts ORDER BY updated_at DESC LIMIT 1')
        row = c.fetchone()
        return row[0] if row else None

def save_image_rating(dataset_path, filename, rating, file_hash=None):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT OR REPLACE INTO image_ratings (dataset_path, filename, rating, file_hash)
            VALUES (?, ?, ?, ?)
        ''', (dataset_path, filename, rating, file_hash))
        conn.commit()

def get_image_rating_and_hash(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT rating, file_hash FROM image_ratings WHERE dataset_path=? AND filename=?',
                  (dataset_path, filename))
        row = c.fetchone()
        return row if row else (None, None)

def get_image_rating(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT rating FROM image_ratings WHERE dataset_path=? AND filename=?', (dataset_path, filename))
        row = c.fetchone()
        return row[0] if row else None

def get_all_ratings_for_dataset(dataset_path):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT filename, rating FROM image_ratings WHERE dataset_path=?', (dataset_path,))
        return {row[0]: row[1] for row in c.fetchall()}

def clear_all_analysis_data():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM image_ratings')
        c.execute('DELETE FROM image_quality')
        c.execute('DELETE FROM similar_pairs')
        c.execute('DELETE FROM duplicate_groups')
        conn.commit()

def save_dataset_vocabulary(dataset_path, content_json):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT OR REPLACE INTO dataset_vocabulary (dataset_path, content, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        ''', (dataset_path, content_json))
        conn.commit()

def get_dataset_vocabulary(dataset_path):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT content FROM dataset_vocabulary WHERE dataset_path=?', (dataset_path,))
        row = c.fetchone()
        return row[0] if row else None

def get_version_stats(version_path):
    if not os.path.isdir(version_path):
        return None

    images = get_image_files(version_path)
    total_images = len(images)

    mult32_count = 0
    mult64_count = 0
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        for img in images:
            c.execute('SELECT multiple_32, multiple_64 FROM image_quality WHERE dataset_path=? AND filename=?',
                      (version_path, img))
            row = c.fetchone()
            if row:
                if row[0]:
                    mult32_count += 1
                if row[1]:
                    mult64_count += 1
            else:
                img_path = os.path.join(version_path, img)
                try:
                    with Image.open(img_path) as pil_img:
                        w, h = pil_img.size
                        mult32 = (w % 32 == 0 and h % 32 == 0)
                        mult64 = (w % 64 == 0 and h % 64 == 0)
                except Exception:
                    mult32 = False
                    mult64 = False
                if mult32:
                    mult32_count += 1
                if mult64:
                    mult64_count += 1

    total_tags_count = 0
    all_tags_set = set()
    for img in images:
        txt_path = get_caption_path(os.path.join(version_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        total_tags_count += len(tags)
        all_tags_set.update(tags)

    avg_tags = total_tags_count / total_images if total_images else 0
    unique_tags_count = len(all_tags_set)

    duplicate_files = set()
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT files FROM duplicate_groups WHERE dataset_path=?', (version_path,))
        for row in c.fetchall():
            files = json.loads(row[0])
            duplicate_files.update(files)
        c.execute('SELECT filename1, filename2 FROM similar_pairs WHERE dataset_path=?', (version_path,))
        for f1, f2 in c.fetchall():
            duplicate_files.add(f1)
            duplicate_files.add(f2)

    duplicate_count = len(duplicate_files)

    avg_quality = 0.0
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT AVG(overall_quality) FROM image_quality WHERE dataset_path=?', (version_path,))
        row = c.fetchone()
        if row and row[0] is not None:
            avg_quality = row[0]

    return {
        'total_images': total_images,
        'multiple_32': mult32_count,
        'multiple_64': mult64_count,
        'avg_tags_per_image': avg_tags,
        'unique_tags': unique_tags_count,
        'duplicates': duplicate_count,
        'avg_overall_quality': avg_quality
    }
