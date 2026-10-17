"""Offline PHP routing/security smoke test. No JavaScript or external network requests run."""
from __future__ import annotations
import os
import json
import copy
import re
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor

ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get("PHP_BINARY") or shutil.which("php")
if not PHP:
    raise SystemExit("Set PHP_BINARY or put php on PATH")

with tempfile.TemporaryDirectory(prefix="p2w-http-test-") as directory:
    folder = Path(directory)
    data = folder / "data"
    data.mkdir()
    db = sqlite3.connect(data / "shop-index.sqlite")
    db.executescript("""
      CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT);
      CREATE TABLE types(slug TEXT PRIMARY KEY,name TEXT,game TEXT,kind TEXT,count INTEGER);
      CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,n TEXT,hay TEXT,slug TEXT,img TEXT,thumb TEXT,set_name TEXT,set_slug TEXT,type TEXT,type_slug TEXT,game TEXT,kind TEXT,rel INTEGER,descr TEXT,qty INTEGER,from_p INTEGER);
      CREATE TABLE listings(id INTEGER PRIMARY KEY,pid INTEGER,c TEXT,v TEXT,q INTEGER,p INTEGER,vid INTEGER,crank INTEGER,src INTEGER,name TEXT,type TEXT);
      INSERT INTO types VALUES('pokemon-singles','Pokemon Singles','Pokemon','Singles',1);
      INSERT INTO products VALUES(42,'Audit Card - 001/100','audit card 001 100',' audit card pokemon ','audit-card','','','Audit Set','pokemon-singles-audit-set','Pokemon Singles','pokemon-singles','Pokemon','Singles',1,'Offline fixture',2,100);
      INSERT INTO listings VALUES(43,42,'Near Mint','',2,100,42,1,1,'Audit Card','Pokemon Singles');
    """)
    now = int(time.time())
    db.executemany("INSERT INTO meta VALUES(?,?)", [(k,str(v)) for k,v in {"built":now,"listingsAt":now,"catalogAt":now-21600,"products":1}.items()])
    db.commit()
    db.close()
    # Route only local PHP, never the deployed shop. Missing-password header is a test-only switch.
    router = folder / "router.php"
    router.write_text("<?php if (isset($_SERVER['HTTP_X_LOCAL_NO_PASSWORD'])) putenv('SHOP_PASSWORD='); "
                      "$p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(is_file(" + repr(ROOT.as_posix()) + ".$p)) return false; "
                      "if(str_starts_with($p,'/shop')) { require " + repr((ROOT / "shop/index.php").as_posix()) + "; return true; } return false;", encoding="utf-8")
    env = os.environ.copy()
    state = {"created":0,"captured":0,"payments":{}}
    class FakeAPI(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def answer(self,body):
            raw=json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def do_GET(self):
            if self.path=="/variants/42":
                self.answer({"variant":{"id":42,"available_qty":2,"sell_price":{"money":{"cents":100}},"descriptors":[{"name":"condition","value":"NM"}]}})
            elif self.path.startswith("/v2/checkout/orders/"):
                self.answer(state["payments"].get(self.path.rsplit("/",1)[-1],{"status":"CREATED"}))
            elif self.path=="/orders/9001": self.answer({"order":{"id":9001,"status":"Void"}})
            else:
                self.send_error(404)
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length","0")))
            if self.path=="/v1/oauth2/token": self.answer({"access_token":"local-only","expires_in":3600})
            elif self.path=="/v2/checkout/orders":
                state["created"]+=1
                self.answer({"id":f"LOCAL-PP-{state['created']}"})
            elif self.path.endswith("/capture"):
                state["captured"]+=1
                body={"status":"COMPLETED","purchase_units":[{"payments":{"captures":[{"id":"LOCAL-CAPTURE","status":"COMPLETED","amount":{"value":"1.09","currency_code":"USD"}}]}}]}
                state["payments"][self.path.split("/")[-2]]=body
                self.answer(body)
            else: self.send_error(404)
    fake=ThreadingHTTPServer(("127.0.0.1",0),FakeAPI)
    threading.Thread(target=fake.serve_forever,daemon=True).start()
    fake_base=f"http://127.0.0.1:{fake.server_address[1]}"
    env.update(P2W_SHOP_DATA=str(data), SHOP_PASSWORD="local-preview-test", PAYPAL_MODE="sandbox", SHOP_ORDERS="test",
               PAYPAL_SANDBOX_CLIENT_ID="fixture", PAYPAL_SANDBOX_SECRET="fixture", KIOSK_STAFF_KEY="local-staff-test-key-only",
               SHOP_SYNC_KEY="local-sync-test-key", CC_API_PROXY_SECRET="fixture", SHOP_SYNC_URL="",
               KIOSK_KEY="local-kiosk-test-key-only",KIOSK_MODE="test",
               P2W_PAYPAL_API_BASE=fake_base,CC_ADMIN_BASE_URL=fake_base,SHOP_SMTP_HOST="127.0.0.1",SHOP_SMTP_PORT="1")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        port = sock.getsockname()[1]
    with (folder / "php.log").open("w+") as log:
        process = subprocess.Popen([PHP,"-S",f"127.0.0.1:{port}","-t",str(ROOT),str(router)],env=env,stdout=log,stderr=log,cwd=ROOT)
        try:
            cookies = CookieJar()
            opener = build_opener(HTTPCookieProcessor(cookies))
            def request(path, values=None, headers=None, json_body=None):
                body=urlencode(values).encode() if values is not None else None
                if json_body is not None:
                    body=json.dumps(json_body).encode()
                    headers={**(headers or {}),"Content-Type":"application/json"}
                req=Request(f"http://127.0.0.1:{port}"+path, data=body, headers=headers or {})
                try:
                    with opener.open(req,timeout=10) as r: return r.status,r.read().decode(),r.headers,r.url
                except HTTPError as r: return r.code,r.read().decode(),r.headers,r.url
            for _ in range(100):
                try: request("/shop"); break
                except URLError: time.sleep(.05)
            else: raise AssertionError("Local PHP did not start")
            assertions=0
            def check(value,label):
                global assertions
                assert value,label
                assertions+=1
            s,b,h,u=request("/shop")
            check(s==401 and "/shop/login" in u,"preview password required")
            check("noindex" in h.get("X-Robots-Tag",""),"preview search indexing disabled")
            s,b,h,u=request("/shop/login",{"password":"local-preview-test","next":"/shop"})
            check(s==200 and "Find your next pull" in b,"preview login")
            check("6 hours ago" in b,"full catalog age, not fresh Core2 age")
            s,b,h,u=request("/shop/product/42-audit-card")
            check(s==200 and "Add to cart" in b,"product controls")
            s,b,h,u=request("/shop/cart",{"do":"add","listing":"43","qty":"1"})
            check(s==200 and "$1.09" in b,"cart tax arithmetic")
            s,b,h,u=request("/shop/checkout")
            check(s==200 and "wait for the store" in b and "privacy.html" in b,"checkout information")
            check("no-store" in h.get("Cache-Control",""),"checkout cache privacy")
            details={"name":"Local Fixture","email":"audit@example.invalid","phone":""}
            s,b,h,u=request("/shop/checkout/create",json_body=details)
            payment=json.loads(b).get("id")
            check(s==200 and payment and state["created"]==1,"create using fake inventory and PayPal")
            s,b,h,u=request("/shop/checkout/create",json_body=details)
            check(json.loads(b).get("id")==payment and state["created"]==1,"unchanged retry reuses pending payment")
            details["name"]="Changed Fixture"
            s,b,h,u=request("/shop/checkout/create",json_body=details)
            payment=json.loads(b).get("id")
            check(state["created"]==2,"changed pickup details replace only an unattempted checkout")
            s,b,h,u=request("/shop/checkout/capture",json_body={"id":payment})
            confirmation=json.loads(b).get("redirect")
            check(s==200 and confirmation and state["captured"]==1,"capture and confirmation using fake money")
            s,b,h,u=request("/shop/checkout/capture",json_body={"id":payment})
            check(json.loads(b).get("redirect")==confirmation and state["captured"]==1,"capture retries do not charge twice")
            s,b,h,u=request(confirmation)
            check(s==200 and "Changed Fixture" in b and "email delivery is still being checked" in b,"receipt reflects failed mail and correct pickup contact")
            check(request(confirmation.split("?")[0]+"?k=wrong")[0]==404,"receipt signature required")
            request("/shop/cart",{"do":"add","listing":"43","qty":"1"})
            s,b,h,u=request("/shop/checkout")
            check("data-checkout-form" in b and "data-payment-recovery" not in b,"a paid order must not block a later purchase")
            request("/shop/checkout/capture",json_body={"id":payment})
            s,b,h,u=request("/shop/cart")
            check("Your cart is empty" not in b and state["captured"]==1,"retrying an old payment must preserve a newer cart")
            check(request("/shop/manage")[0]==404,"staff queue requires staff cookie")
            check(request("/shop/admin-check.php")[0]==403,"diagnostic authentication")
            check(request("/shop/sync.php")[0]==403,"sync authentication")
            check(request("/shop/reconcile.php")[0]==403,"worker authentication")
            check(request("/shop",headers={"X-Local-No-Password":"1"})[0]==503,"preview fails closed without password")
            check(request("/shop/kiosk/staff?key=local-staff-test-key-only")[0]==200,"staff sign-in")
            s,b,h,u=request("/shop/manage")
            check(s==200 and "Website orders" in b,"staff queue route")
            check(request("/shop/manage",{"do":"check","ref":"fake","token":"wrong"})[0]==404,"staff CSRF protection")
            s,b,h,u=request("/shop/cart",{"do":"remove","listing":"43"})
            check("Your cart is empty" in b,"cart removal")
            request("/shop/kiosk/start?key=local-kiosk-test-key-only")
            request("/shop/kiosk/cart",{"do":"add","listing":"43","qty":"1"})
            previous_cookie=next(copy.copy(c) for c in cookies if c.name=="p2w_kcart")
            s,b,h,u=request("/shop/kiosk/checkout",{"name":"Local Kiosk","token":"a"*32})
            kiosk_orders=json.loads((data/"kiosk-orders.json").read_text())
            check(s==200 and len(kiosk_orders["orders"])==1 and kiosk_orders["orders"][0]["num"]=="T1","kiosk checkout works with versioned cart")
            cookies.set_cookie(previous_cookie)  # simulate a lost response and a new form after refresh
            s,b,h,u=request("/shop/kiosk/checkout",{"name":"Local Kiosk","token":"b"*32})
            kiosk_orders=json.loads((data/"kiosk-orders.json").read_text())
            check(s==200 and len(kiosk_orders["orders"])==1 and u.endswith("/shop/kiosk/done/T1"),"kiosk refresh with a new token cannot duplicate the order")
            attempt=data/("kiosk-attempt-"+"f"*64+".json")
            attempt.write_text(json.dumps({"status":"verifying","ccId":9001,"name":"Local Fixture"}))
            s,b,h,u=request("/shop/kiosk/orders")
            csrf=re.search(r'name="token" value="([^"]+)"',b).group(1)
            request("/shop/kiosk/orders",{"token":csrf,"attempt":"f"*64,"ccId":"9001"})
            check(json.loads(attempt.read_text())["status"]=="recorded","staff can close a kiosk exception only after remote Void verification")
            log.flush()
            log.seek(0)
            output=log.read()
            check("PHP Fatal" not in output and "PHP Warning" not in output,"no PHP runtime errors")
            print(f"Offline shop HTTP checks passed ({assertions} assertions).")
        finally:
            process.terminate()
            process.wait(timeout=10)
            fake.shutdown()
            fake.server_close()
