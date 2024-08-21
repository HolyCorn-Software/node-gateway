/**
 * Copyright 2024 HolyCorn Software
 * The node-gateway Project
 * This module (router), deals mainly with the logic of getting data from the user, to the right server
 */

import http from 'node:http'
import libFs from 'node:fs'
import libPath from 'node:path'
import DomainHandler from "./handler.mjs";
import { Socket } from "node:net";
import WebsocketHandshake from "./websocket/handshake.mjs";

const server = Symbol()


export default class DomainRouter {

    /**
     * 
     * @param {DomainHandler} handler 
     */
    constructor(handler) {
        this.handler = handler
    }

    async destroy() {

        this[server].removeAllListeners()
        if (this[server].listening) {
            await new Promise(
                (resolve, reject) => this[server].close((err) => {
                    if (err != null) reject(err)
                    resolve()
                })
            )
        }
        delete this.handler
        delete this[server]

    }

    async init() {
        this[server] = http.createServer();

        /**
         * This method connects to the end-point socket being used by the client domain server
         * 
         */
        const socketConnect = async () => {
            const socket = new Socket()

            await new Promise((resolve, reject) => {
                try {
                    socket.connect({
                        path: libPath.normalize(`${this.handler.path}/socket`),
                    }, (err) => {
                        if (err) reject(new Error(`Could not connect\n${err}`))
                        resolve()
                    });
                } catch (e) {
                    reject(new Error(`Socket connect error\n${e}`))
                }
            })

            return socket
        }

        this[server].addListener('request', async (req, res) => {

            const path = libPath.normalize(`${this.handler.httpOverrideDir}${req.url}`)

            // Here, we're just trying to determine if the request is to a file located in the overriden directory
            if ((libPath.relative(this.handler.httpOverrideDir, path)).indexOf('../') == -1) {

                if (libFs.existsSync(path)) {
                    // If so, then let's serve it
                    const stat = (await libFs.promises.stat(path))
                    if (stat.isFile()) {
                        // Time to read the file
                        const ext = path.split('/').at(-1).split('.')[1]
                        res.writeHead(200, "FOUND", {
                            'content-length': stat.size,
                            'content-type': DomainRouter.mimes[ext] || 'application/octet-stream',
                        });

                        libFs.createReadStream(path).pipe(res);
                        return;
                    }
                }
            }

            // Now, reaching this point, means that we're supposed to route to the server
            const socket = await socketConnect()

            socket.write((`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` + `${Object.entries(req.headers).map(x => `${x[0]}:${x.slice(1).join(',')}`).join('\r\n')}\r\n\r\n`),
                (err) => {
                    if (err) console.warn(`Could not write `, err)
                }
            );

            req.addListener('data', (chunk) => {
                socket.write(chunk, (error) => {
                    if (error) console.warn(`Could not relay `, error)
                })
            })

            socket.addListener('data', (buf) => {
                req.socket.write(buf, (error) => {
                    if (error) console.warn(`Could not relay `, error)
                })
            });


            socket.addListener('error', (error) => {
                console.warn(`TCP error, with ${this.handler.domain}\n`, error)
                socket.end()
                req.socket.end()
            })


        });


        // The logic of forwarding websockets
        this[server].addListener('upgrade', async (req, sockIn) => {

            const sockOut = await socketConnect()

            await WebsocketHandshake.incoming(sockIn, req)

            await WebsocketHandshake.outBound({
                path: req.url,
                socket: sockOut,
                headers: req.headers
            })

            sockOut.pipe(sockIn);
            sockIn.pipe(sockOut)

        })
    }
    /**
     * This method receives the client, and handles it.
     * Either a raw socket is passed, or http request and responses are passed.
     * The socket is considered of the least priority.
     * @param {object} param0 
     * @param {import('node:net').Socket} param0.socket
     * @param {import('node:http').ClientRequest} param0.request
     * @param {import('node:http').ServerResponse} param0.response
     */
    async onSocket({ socket, request, response }) {
        if (request) {
            this[server].emit('request', request, response)
        } else if (socket) {
            this[server].emit('connection', socket)
        }

    }

    static mimes = {
        'txt': 'text/plain',
        'html': 'text/html',
        'png': 'image/png',
        'jpg': 'image/jpg',
        'jpeg': 'image/jpg'
    }

}