/**
 * Copyright 2024 HolyCorn Software
 * The node-gateway
 * This module (domain-handler), is directly concerned with the needs of a client domain.
 * This includes SSL renewal, and routing
 */


import chokidar from 'chokidar'
import SSLManager from './ssl/manager.mjs'
import libPath from 'node:path'
import libFs from 'node:fs'
import DomainRouter from './router.mjs'

const privateWatcher = Symbol()


export default class DomainHandler {


    /**
     * 
     * @param {object} param0 
     * @param {string} param0.path
     * @param {chokidar.FSWatcher} param0.watcher
     */
    constructor({ path, watcher }) {
        this.watcher = watcher || (() => { this[privateWatcher] = true })() || chokidar.watch(path)
        this.path = path
        this.ssl = new SSLManager(this)
        this.ssl.init().catch(e => console.warn(e))
        this.router = new DomainRouter(this);
    }

    async destroy() {
        console.log(`Destroying domain handler for ${this.path}`)
        if (this[privateWatcher]) await this.watcher.close()
        await this.ssl.destroy()
        await this.router.destroy();
        delete this.watcher
        delete this.path
        delete this.ssl
        delete this.router
    }

    /** @readonly */
    get sslDir() {
        return libPath.normalize(`${this.path}/ssl`)
    }

    /** @readonly */
    get httpOverrideDir() {
        return libPath.normalize(`${this.path}/override-http`)
    }

    async init() {
        if (!libFs.existsSync(this.sslDir)) {
            await libFs.promises.mkdir(this.sslDir, { recursive: true, mode: 700 })
        }
        if (!libFs.existsSync(this.httpOverrideDir)) {
            await libFs.promises.mkdir(this.httpOverrideDir, { recursive: true, mode: '0777' })
        }

        await this.router.init()
    }

    get domain() {
        return this.path.split('/').at(-1)
    }


}