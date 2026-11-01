import { onRequest } from 'firebase-functions/v2/https';
import { createProxy } from './proxy.js';

// Entrada alternativa de DUPLA en Google: https://<región>-<proyecto>.cloudfunctions.net/dupla (o su URL de Cloud Run).
export const dupla=onRequest({region:'europe-west1',memory:'256MiB',timeoutSeconds:300,maxInstances:2,concurrency:40,invoker:'public'},
 createProxy(process.env.DUPLA_ORIGEN||'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'));
