/**
 * Copyright 2024 HolyCorn Software
 * The node-gateway
 * This program is meant to allow multiple apps run seamlessly on a single computer.
 */

import libUrl from 'node:url'
import colors from 'colors'
import NodeGateway from './gateway.mjs'
import libPath from 'node:path'

colors.enable();

const path = libPath.resolve(
    libPath.dirname(libUrl.fileURLToPath(import.meta.url)),
    process.env['datapath'] || (() => {
        const defaultPath = libUrl.fileURLToPath(new URL(`./example`, import.meta.url).href)
        console.warn(`The ${'datapath'.blue} argument was not passed. We're using the default ${defaultPath.cyan}`);
        return defaultPath;
    })()
)

const gateway = new NodeGateway(path)

try {
    await gateway.init()
} catch (e) {
    console.error(e.message || e.stack || e)
    process.exit(-1)
}

process.addListener('uncaughtException', (e) => {
    console.warn(`Uncaught Exception\n`, e)
});

process.addListener('unhandledRejection', (reason, prom) => {
    console.warn(`Unhandled rejection\n`, reason, `\n`, prom)
})