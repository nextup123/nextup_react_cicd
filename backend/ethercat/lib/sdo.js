'use strict';

const config = require('../config');
const { parseIndex, normaliseDtype, toInt } = require('./util');
const activity = require('./activity');

let bridge = null;
function setBridge(b) { bridge = b; }
function getBridge() { return bridge; }

/**
 * Validate + normalise a request body into the SDO service request shape.
 * Throws a 400-style error on bad input instead of silently writing to
 * index 0 / slave 0.
 */
function buildRequest(body, { withValue }) {
  const index = parseIndex(body.sdo_index ?? body.index);
  const subindex = parseIndex(body.sdo_subindex ?? body.subindex);
  if (Number.isNaN(index) || Number.isNaN(subindex) || index > 0xffff || subindex > 0xff) {
    const err = new Error(`Invalid index/subindex: "${body.sdo_index ?? body.index}" / "${body.sdo_subindex ?? body.subindex}"`);
    err.status = 400;
    throw err;
  }
  const req = {
    master_id: toInt(body.master_id, 0),
    slave_position: toInt(body.slave_position, 0),
    sdo_index: index,
    sdo_subindex: subindex,
    sdo_data_type: normaliseDtype(body.sdo_data_type ?? body.dataType),
  };
  if (withValue) {
    const v = body.sdo_value ?? body.value;
    if (v === undefined || v === null || String(v).trim() === '') {
      const err = new Error('A value is required for SDO write');
      err.status = 400;
      throw err;
    }
    req.sdo_value = String(v).trim();
  }
  return req;
}

function shapeSet(res) {
  return { success: !!res.success, sdo_return_message: res.sdo_return_message ?? '' };
}

function shapeGet(res) {
  return {
    success: !!res.success,
    sdo_return_value: res.sdo_return_value,
    sdo_return_value_string: res.sdo_return_value_string,
    sdo_return_message: res.sdo_return_message ?? '',
  };
}

async function setSdo(body, call) {
  const req = buildRequest(body, { withValue: true });
  activity.noteWrite('A value was just written to a drive');
  const { type, name } = config.SDO_SET_SERVICE;
  const res = call ? await call(type, name, req) : await bridge.callService(type, name, req);
  return shapeSet(res);
}

async function getSdo(body, call) {
  const req = buildRequest(body, { withValue: false });
  const { type, name } = config.SDO_GET_SERVICE;
  const res = call ? await call(type, name, req) : await bridge.callService(type, name, req);
  return shapeGet(res);
}

module.exports = { setBridge, getBridge, buildRequest, setSdo, getSdo };
