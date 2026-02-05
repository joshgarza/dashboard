import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  type: 'raspberry-pi' | 'server' | 'other';
  createdAt: string;
}

export interface CreateDeviceInput {
  name: string;
  host: string;
  port: number;
  type: 'raspberry-pi' | 'server' | 'other';
}

const DEVICES_FILE = path.join(process.cwd(), 'devices.json');

let devices: Device[] = [];
let initialized = false;

function loadDevices(): void {
  if (initialized) return;

  try {
    if (fs.existsSync(DEVICES_FILE)) {
      const data = fs.readFileSync(DEVICES_FILE, 'utf-8');
      devices = JSON.parse(data);
    }
  } catch {
    devices = [];
  }
  initialized = true;
}

function saveDevices(): void {
  try {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
  } catch (error) {
    console.error('Failed to save devices:', error);
  }
}

export function getAllDevices(): Device[] {
  loadDevices();
  return [...devices];
}

export function getDeviceById(id: string): Device | undefined {
  loadDevices();
  return devices.find((d) => d.id === id);
}

export function createDevice(input: CreateDeviceInput): Device {
  loadDevices();

  const device: Device = {
    id: randomUUID(),
    name: input.name,
    host: input.host,
    port: input.port,
    type: input.type,
    createdAt: new Date().toISOString(),
  };

  devices.push(device);
  saveDevices();

  return device;
}

export function deleteDevice(id: string): boolean {
  loadDevices();

  const index = devices.findIndex((d) => d.id === id);
  if (index === -1) {
    return false;
  }

  devices.splice(index, 1);
  saveDevices();

  return true;
}

export function resetRegistry(): void {
  devices = [];
  initialized = true;
  try {
    if (fs.existsSync(DEVICES_FILE)) {
      fs.unlinkSync(DEVICES_FILE);
    }
  } catch {
    // Ignore errors when deleting
  }
}
