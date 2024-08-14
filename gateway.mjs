/**
 * Copyright 2024 HolyCorn Software
 * The node-gateway Project
 * This module deals with the overall management of the gateway.
 */


import libFs from 'node:fs'
import DomainHandler from './domain-handler/handler.mjs';
import chokidar from 'chokidar'
import libPath from 'node:path'
import libOs from 'node:os'
import tls from 'node:tls';
import http from 'node:http'

const handlers = Symbol()
const watcher = Symbol()

export default class NodeGateway {

    /**
     * 
     * @param {string} dir 
     */
    constructor(dir) {
        this.dir = dir;

        /** @type {DomainHandler[]} */
        this[handlers] = []
    }

    async init({ createDir } = {}) {
        if (!libFs.existsSync(this.dir)) {
            if (!createDir) {
                throw new Error(`The gateway was initialized for the directory ${this.dir}, which is non-existent. You can pass the 'createDir' parameter, to automatically create it next time. `)
            }
            await libFs.promises.mkdir(this.dir, { recursive: true })
        }

        if (libOs.userInfo().uid != 0) {
            throw new Error(`Please, run the program as root.\nRoot access is necessary for SSL.\n`)
        }

        const domainsPath = libPath.normalize(libPath.resolve(`${this.dir}/domains`))
        await libFs.promises.mkdir(domainsPath, { recursive: true })


        this[watcher] = chokidar.watch(this.dir);

        this[watcher].on('addDir', (path, stat) => {
            // Our objective here, is to check which domain directory the newly added path refers to.
            path = libPath.normalize(path);

            if ((path.replace(domainsPath, '').replace(this.dir, '').split('/').filter(x => x != '/')).length < 2) {
                return;
            }
            const domainPath = path;
            if (this[handlers].findIndex(x => x.path != domainPath) == -1) {

                this[handlers].push(
                    (() => {
                        const handler = new DomainHandler({
                            path: domainPath,
                            watcher: this[watcher]
                        });
                        handler.init().catch(e => {
                            console.warn(`Could not initialize handler for ${handler.path}\n`, e)
                            this[handlers] = this[handlers].filter(x => x != handler)
                        })
                        return handler
                    })()
                );
            }
        });

        this[watcher].on('unlinkDir', () => {
            const keep = []
            for (const item of this[handlers]) {
                if (libFs.existsSync(item.path)) {
                    keep.push(item);
                } else {
                    item.destroy()
                }
            }
            this[handlers] = keep;
        })

        this.server = tls.createServer({
            SNICallback: async (servername, cb) => {
                // Our job here, is to respond with the correct SSL certificate
                const handler = this[handlers].find(x => x.domain == servername)
                if (!handler) {
                    console.warn(`Server not found for ${servername}`)
                    cb(new Error(`Server not found for ${servername}`))
                    return;
                }

                function file(path) {
                    return libFs.promises.readFile(path)
                }

                try {
                    cb(null, tls.createSecureContext({
                        cert: await file(handler.ssl.certPath),
                        key: await file(handler.ssl.keyPath),
                    }))
                } catch (e) {
                    cb(new Error(`SSL error!`))
                    console.warn(e)
                }
            },
        });


        /**
         * This method finds a handler for a given domain, or it drops the connection
         * @param {string} domain 
         * @param {import('node:net').Socket} socket 
         */
        const findHandler = (domain, socket) => {

            const handler = this[handlers].find(x => x.domain == domain);

            if (handler) {
                return handler
            }

            socket.write(`Host${domain ? ` ${domain}` : ''} not found`, () => {
                socket.end()
            })
        }


        this.server.listen(443);

        this.server.on('secureConnection', (socket) => {
            findHandler(socket.servername)?.router?.onSocket({ socket });

        })

        this.plaintextServer = http.createServer((req, res) => {
            req.headers['x-plaintext'] = 'true'
            req.headers['x-forwarded-protocol'] = 'http'
            findHandler(req.headers.host?.toLowerCase(), req.socket)?.router.onSocket({ request: req, response: res })
        })

        const plainTextPort = 80

        try {
            await this.plaintextServer.listen({ port: plainTextPort, exclusive: false })
            await new Promise((resolve, reject) => {
                this.plaintextServer.once('listening', resolve)
                this.plaintextServer.once('error', (err) => {
                    reject(err)
                    this.plaintextServer.removeAllListeners()
                })
            })
        } catch (err) {
            console.error(`Could not start plaintext HTTP server on port ${plainTextPort}. `, err.code == 'EADDRINUSE' ? `Address is already in use.` : `\n${err}`)
        }

    }

}