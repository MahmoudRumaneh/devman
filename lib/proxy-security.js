'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const PRIVATE_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToNumber(address) {
  return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(address) {
  const value = ipv4ToNumber(address);
  return PRIVATE_IPV4_RANGES.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToNumber(network) & mask);
  });
}

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('2001:db8:');
}

function getAllowedHosts() {
  return (process.env.ALLOWED_PROXY_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

async function validateProxyUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Enter a valid target URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS target URLs are supported');
  }
  if (url.username || url.password) throw new Error('Target URLs cannot contain credentials');

  const hostname = url.hostname.toLowerCase();
  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length && !allowedHosts.includes(hostname)) {
    throw new Error('This target host is not in ALLOWED_PROXY_HOSTS');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Private and local target hosts are not available from the deployed app');
  }

  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Private and reserved target addresses are not allowed');
  }

  return url;
}

module.exports = { validateProxyUrl };
