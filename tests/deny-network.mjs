// Unit/component suites have no permission to contact a backend, even with leaked CI env.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('Safe audit suite blocked a network request'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
syncBuiltinESMExports();
