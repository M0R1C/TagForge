from flask import Blueprint, request, jsonify
from database import get_setting, set_setting, get_all_translations, DB_PATH
import sqlite3
import qrcode
from io import BytesIO
from flask import send_file
from utils import get_server_ips

settings_bp = Blueprint('settings', __name__, url_prefix='/api')
settings_bp.context = None

def _get_context():
    return settings_bp.context

@settings_bp.route('/languages', methods=['GET'])
def get_languages():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT DISTINCT lang FROM translations')
        langs = [row[0] for row in c.fetchall()]
    return jsonify(langs)

@settings_bp.route('/translations/<lang>', methods=['GET'])
def get_translations(lang):
    return jsonify(get_all_translations(lang))

@settings_bp.route('/settings', methods=['GET'])
def get_settings():
    lang = get_setting('language', 'ru')
    color = get_setting('accent_color', '#3b82f6')
    wd = get_setting('working_directory', '')
    zoom_enabled = get_setting('zoom_enabled', 'true') == 'true'
    zoom_factor = float(get_setting('zoom_factor', '2.0'))
    server_host = get_setting('server_host', '')
    server_port = get_setting('server_port', '')
    batch_size = int(get_setting('batch_size', '8'))
    return jsonify({
        'language': lang,
        'accent_color': color,
        'working_directory': wd,
        'zoom_enabled': zoom_enabled,
        'zoom_factor': zoom_factor,
        'server_host': server_host,
        'server_port': server_port,
        'batch_size': batch_size
    })

@settings_bp.route('/settings', methods=['POST'])
def save_settings():
    data = request.get_json()
    lang = data.get('language')
    color = data.get('accent_color')
    wd = data.get('working_directory')
    zoom_enabled = data.get('zoom_enabled')
    zoom_factor = data.get('zoom_factor')
    server_host = data.get('server_host')
    server_port = data.get('server_port')
    batch_size = data.get('batch_size')

    old_host = get_setting('server_host', '')
    old_port = get_setting('server_port', '')

    if lang:
        set_setting('language', lang)
    if color:
        set_setting('accent_color', color)
    if wd is not None:
        set_setting('working_directory', wd)
    if zoom_enabled is not None:
        set_setting('zoom_enabled', 'true' if zoom_enabled else 'false')
    if zoom_factor is not None:
        set_setting('zoom_factor', str(zoom_factor))
    if server_host is not None:
        set_setting('server_host', server_host)
    if server_port is not None:
        set_setting('server_port', server_port)
    if batch_size is not None:
        try:
            batch_size = int(batch_size)
            if batch_size < 1:
                batch_size = 1
            set_setting('batch_size', str(batch_size))
        except (ValueError, TypeError):
            pass

    host_changed = server_host is not None and server_host != old_host
    port_changed = server_port is not None and server_port != old_port
    if host_changed or port_changed:
        new_host = server_host if server_host is not None else old_host
        new_port = server_port if server_port is not None else old_port
        try:
            from utils import update_run_bat
            update_run_bat(new_host, new_port)
        except Exception as e:
            return jsonify({'success': True, 'warning': f'Настройки сохранены, но не удалось обновить run.bat: {e}'})

    return jsonify({'success': True})

@settings_bp.route('/qr-code', methods=['GET'])
def get_qr_code():
    ctx = _get_context()
    if ctx is None:
        return '', 204

    client_ip = request.remote_addr
    server_ips = get_server_ips()
    if client_ip not in server_ips:
        return '', 204

    host = ctx.active_host
    port = ctx.active_port
    if not host or host in ('127.0.0.1', 'localhost'):
        return '', 204

    if host == '0.0.0.0':
        non_loopback = [ip for ip in server_ips if ip != '127.0.0.1']
        if not non_loopback:
            return '', 204
        host = non_loopback[0]

    url = f"http://{host}:{port}"
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return send_file(buffer, mimetype='image/png')