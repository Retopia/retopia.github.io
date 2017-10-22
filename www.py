#/usr/bin/python
import sys
import BaseHTTPServer
import socket
from SimpleHTTPServer import SimpleHTTPRequestHandler

HandlerClass = SimpleHTTPRequestHandler
ServerClass  = BaseHTTPServer.HTTPServer
Protocol     = "HTTP/1.0"

if sys.argv[1:]:
  port = int(sys.argv[1])
else:
  port = 80
#server_address = ('127.0.0.1', port)
#server_address = ('220.133.169.171', port)
#server_address = ('10.6.24.147', port)
#server_address = ('192.168.0.16', port)
server_address = (socket.gethostbyname(socket.gethostname()), port)

HandlerClass.protocol_version = Protocol
httpd = ServerClass(server_address, HandlerClass)

sa = httpd.socket.getsockname()
print "Serving HTTP on", sa[0], "port", sa[1], "..."
httpd.serve_forever()
