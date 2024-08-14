/**
 * Copyright 2024 HolyCorn Software
 * The node-gateway Project
 * This module (domain-handler/ssl/manager), is what handles the SSL needs of a client domain.
 * This includes auto-verifying a domain, and scheduling cert renewal.
 */

import DomainHandler from "../handler.mjs";
import libFS from 'node:fs'
import libPath from 'node:path'
import crypto, { X509Certificate } from 'node:crypto'
import child_process from 'node:child_process'

const check = Symbol()
const checkTimeout = Symbol()
const watcherCallback = Symbol()
const longCheckTimeout = Symbol()


export default class SSLManager {


    /**
     * 
     * @param {DomainHandler} handler 
     */
    constructor(handler) {
        this.handler = handler
    }

    async init() {

        this[check]();

        let dirChangeTimeout;

        // Now, let's make sure whenever the SSL directory changes, let's check to see that SSL is in tact
        this.handler.watcher.on('change', this[watcherCallback] = (path) => {
            if (path.startsWith(this.handler.sslDir)) {
                dirChangeTimeout = setTimeout(() => {
                    this[check]()
                }, 1000)
            }
        })
    }

    async destroy() {
        this.handler.watcher.removeListener('change', this[watcherCallback])
        clearTimeout(this[checkTimeout])
        delete this.handler
    }

    async [check]() {

        const clear = () => clearTimeout(this[checkTimeout])

        clear()

        const schedule = (timeout) => {
            clear()
            this[checkTimeout] = setTimeout(() => this[check](), timeout || 30_000);
        }

        const cert = await this.checkCERT();
        if (!cert) {
            try {
                console.log(`SSL for ${this.handler.domain} is invalid. We're issuing new credentials.`)
                await this.issueCERT()
            } catch (e) {
                console.warn(`Could not issue certificate for ${this.handler.domain}, because\n`, e)
                if (/too many/gi.test(`${e}`)) {
                    return schedule(30 * 60 * 1000) // If let's encrypt says there are too many requests, delay this one 30 mins
                }
            }
            schedule();
        } else {
            clearTimeout(this[longCheckTimeout]);
            this[longCheckTimeout] = setTimeout(() => {
                this[check]()
            },
                // schedule a check before 80% of the expiry, but in not more than 1 hour.
                Math.max(
                    ((certExpiryTime(cert) - Date.now()) * 0.8) - 25_000, // assuming that it takes at least 25s to issue another SSL certificate
                    1 * 60 * 60 * 1000
                )
            )

        }

    }


    /** @readonly */
    get certPath() {
        return libPath.normalize(`${this.handler.sslDir}/cert.pem`)
    }

    /** @readonly */
    get keyPath() {
        return libPath.normalize(`${this.handler.sslDir}/key.pem`)
    }
    /**
     * This method checks to see that certificate, exists, and that it corresponds with it.
     */
    async checkCERT() {


        if (![this.certPath, this.keyPath].every(libFS.existsSync)) {
            console.warn(`Certificate and/or Private Key missing from ${this.handler.path} `)
            return false;
        }

        try {

            // Now, is the certificate expired
            const cert = new crypto.X509Certificate(await libFS.promises.readFile(this.certPath))

            if (certExpiryTime(cert) < Date.now()) {
                console.log(`Certificate expired, for ${this.handler.domain}`)
                return false
            }

            if (!cert.checkPrivateKey(
                crypto.createPrivateKey(
                    await libFS.promises.readFile(this.keyPath)
                )
            )) {
                console.log(`Invalid private key for ${this.handler.domain}`)
                return false
            }

            const certCommonName = cert.subject.split('CN=')[1];
            if (certCommonName != this.handler.domain) {
                console.warn(`The SSL certificate for ${this.handler.domain}, is rather indicating ${certCommonName.red}. SSL might not work.`)
            }

            return cert;

        } catch (e) {
            console.warn(`Could not verify SSL credentials for ${this.handler.domain}\n`, e)
            return false;
        }
    }

    async issueCERT() {

        await new Promise((resolve, reject) => {

            child_process.exec(
                `
                if [ ! -f $(which certbot) ]; then
                    echo "Installing certbot."
                    sudo apt-get install -y certbot
                fi;

                sudo certbot certonly --webroot -w "${this.handler.httpOverrideDir}" --agree-tos --register-unsafely-without-email -n -d ${this.handler.domain}

                if [ -f "/etc/letsencrypt/live/${this.handler.domain}/fullchain.pem" ];
                then
                    sudo cp "/etc/letsencrypt/live/${this.handler.domain}/fullchain.pem" "${this.certPath}"
                    sudo cp "/etc/letsencrypt/live/${this.handler.domain}/privkey.pem" "${this.keyPath}"
                fi;
            `,
                (error, out, stderr) => {
                    if (error) reject(error)
                    if (stderr) reject(stderr)
                    console.log(out)
                    resolve(out)
                }
            )


        })
    }

}



/**
 * This method returns the expiry time of a certificate
 * @param {X509Certificate} cert 
 */
function certExpiryTime(cert) {
    return new Date(cert.validTo).getTime()
}