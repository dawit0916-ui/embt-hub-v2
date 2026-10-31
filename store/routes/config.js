import { Router } from 'express';
import { cfg } from '../config.js';
import { AppError, signPayload, wrap } from '../util.js';

export const configRoutes = Router();

/**
 * Signed so a tampered server response cannot swap the certificate pins. The store app also
 * has the current pin built in and must treat any disagreement as an alarm.
 * Response: { payload: base64(json), sig: base64(ed25519) }.
 */
configRoutes.get(
  '/config',
  wrap(async (_req, res) => {
    if (!cfg.configPrivateKey) throw new AppError(503, 'config_not_signed', 'Signing key is not configured');
    if (cfg.pins.length === 0) throw new AppError(503, 'no_pins', 'CERT_PINS is not set');
    res.set('Cache-Control', 'no-store');
    res.json(signPayload(cfg.configPrivateKey, { pins: cfg.pins, issuedAt: new Date().toISOString() }));
  })
);
