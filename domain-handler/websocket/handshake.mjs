
/**
 * Copyright 2024 HolyCorn Software
 * This module makes it possible to do websocket handshakes with both incoming, and outgoing connections.
 */

import crypto from 'node:crypto'



export default class WebsocketHandshake {



    /**
     * 
     * @param {import('net').Socket} socket 
     * @param {import('http').ClientRequest} request
     * @returns {Promise<void>}
     */
    static incoming(socket, request) {

        let known_protocols = [
            'wamp',
            'json'
        ]

        return new Promise((resolve, reject) => {

            try {

                let protocols = request.headers['sec-websocket-protocol']?.split(/ |,/)

                socket.write(`HTTP/1.1 101 Switching to WebSockets\r\n`)

                if (protocols) {
                    let [common_protocol] = protocols.filter(x => known_protocols.includes(x))

                    if (!common_protocol) {
                        console.log(`Client supprised us `)
                    }

                    socket.write(`Sec-WebSocket-Protocol: ${common_protocol}\r\n`)
                }

                socket.write(`Connection: Upgrade\r\n`);
                socket.write(`Upgrade: WebSocket\r\n`);

                socket.write(`Sec-WebSocket-Accept: ${computeSecureAccept(request.headers['sec-websocket-key'])}\r\n`)

                socket.write('\r\n')

                resolve()
            } catch (e) {
                console.warn(e)
                reject(e);
            }
        })
    }

    /**
    * Connect to a WebSocket end-point
    * @param {object} param0
    * @param {string} param0.path
    * @param {net.Socket} param0.socket
    */

    static async outBound({ headers = {}, path, socket } = {}) {


        socket.write(`GET ${path} HTTP/1.1\r\n`)
        socket.write(`Connection: Upgrade\r\n`)
        socket.write('Upgrade: websocket\r\n')

        for (let header in headers) {
            // Forward all headers, except the ones we will generate ourselves
            if (!['connection', 'upgrade', 'sec-websocket-key'].includes(header?.toString().toLowerCase())) {
                socket.write(`${header}: ${headers[header]}\r\n`)
            }
        }


        //Compute a random sec-websocket-key
        let websocket_key = crypto.randomBytes(16).toString('base64')
        socket.write(`sec-websocket-Key: ${websocket_key}\r\n`)

        socket.write('\r\n\r\n')


        await new Promise((complete, fail) => {


            let in_data_frames = []
            socket.on('data', (d) => {

                try {

                    in_data_frames.push(d)

                    let string = Buffer.concat(in_data_frames).toString()

                    //Now if we have read enough...
                    if (string.endsWith('\r\n\r\n')) {
                        let parts = string.split('\r\n');

                        let reg = /Sec-WebSocket-Accept *: *([^ ]+)$/i
                        for (let part of parts) {
                            if (reg.test(part)) {
                                let [, server_hash] = reg.exec(part);
                                // this.validateServerHandShake(websocket_key, server_hash);
                                return complete()
                            }
                        }

                        //Now if, there was no WebSocket-Accept
                        throw new Error(`Endpoint ${url.hostname}/${url.pathname} doesn't support WebSockets`)

                    }

                } catch (e) {
                    fail(e)
                }

            })


        })

        return socket


    }



}






/**
 * A secure hash computed from the clients Sec-Websocket-Key Header
 * This is intended to be used in the Sec-WebSocket-Accept
 * @returns {string}
 */
function computeSecureAccept(key) {
    let hash = crypto.createHash('sha1')
    hash.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'binary')
    return hash.digest().toString('base64')
}
