"""Run the existing simulator handlers in browser memory, without a server."""
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

from obdii_lab.server import create_server


with patch('obdii_lab.server.ThreadingHTTPServer',
           side_effect=lambda address, handler: SimpleNamespace(handler=handler)):
    _browser_lab = create_server(0)


def browser_request(serialized):
    request = json.loads(serialized)
    handler = object.__new__(_browser_lab.handler)
    handler.path = request['path']
    body = (request.get('body') or '').encode('utf-8')
    handler.headers = {'Content-Length': str(len(body))}
    handler.rfile = io.BytesIO(body)
    result = {}

    def send(content, mime='application/json', status=200, filename=None):
        headers = {'Content-Type': mime}
        if filename:
            headers['Content-Disposition'] = f'attachment; filename="{filename}"'
        result.update(status=status, headers=headers, body=content.decode('utf-8'))

    handler.send_bytes = send
    try:
        if request.get('method', 'GET') == 'GET':
            handler.do_GET()
        elif request['method'] == 'POST':
            handler.do_POST()
        else:
            send(json.dumps({'error': 'Method not allowed'}).encode(), status=405)
    except Exception as error:
        send(json.dumps({'error': str(error)}).encode(), status=500)
    return json.dumps(result, allow_nan=False)
