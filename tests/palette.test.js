import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PlanetBubble } from '../content/planet-bubble.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDomainThemePresets() {
  const overlayPath = path.join(__dirname, '..', 'content', 'overlay.js');
  const source = fs.readFileSync(overlayPath, 'utf8');
  const marker = 'const DOMAIN_THEME_PRESETS =';
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error('DOMAIN_THEME_PRESETS not found in overlay.js');
  }
  const arrayStart = source.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error('Failed to parse DOMAIN_THEME_PRESETS');
  }
  const arraySource = source.slice(arrayStart, end + 1);
  const script = new vm.Script(`const DOMAIN_THEME_PRESETS = ${arraySource}; DOMAIN_THEME_PRESETS;`);
  const context = { console };
  return script.runInNewContext(context);
}

function extractPreset(presets, id) {
  const preset = presets.find((entry) => entry.id === id);
  assert.ok(preset, `Preset ${id} should exist`);
  return preset;
}

function assertColorsMatch(palette, expected) {
  const colors = palette.colors || {};
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(colors[key], value, `Expected ${key} color to match for palette`);
  }
}

function testDomainPalettes() {
  const presets = loadDomainThemePresets();

  const yc = extractPreset(presets, 'ycombinator');
  assertColorsMatch(yc.palette, {
    primary: 'rgba(255, 149, 64, 0.88)',
    secondary: 'rgba(255, 102, 0, 0.7)',
    base: 'rgba(92, 32, 4, 0.95)',
    halo: 'rgba(255, 176, 82, 0.72)',
    haloAlt: 'rgba(255, 204, 140, 0.55)',
    faceStroke: 'rgba(255, 239, 224, 0.95)'
  });

  const docs = extractPreset(presets, 'google-docs');
  assertColorsMatch(docs.palette, {
    primary: 'rgba(66, 133, 244, 0.88)',
    secondary: 'rgba(219, 68, 55, 0.7)',
    base: 'rgba(15, 157, 88, 0.95)',
    halo: 'rgba(244, 180, 0, 0.72)',
    haloAlt: 'rgba(52, 168, 83, 0.55)',
    faceStroke: 'rgba(255, 255, 255, 0.96)'
  });

  const metorial = extractPreset(presets, 'metorial');
  assertColorsMatch(metorial.palette, {
    primary: 'rgba(142, 68, 173, 0.86)',
    secondary: 'rgba(241, 196, 15, 0.68)',
    base: 'rgba(32, 46, 110, 0.94)',
    halo: 'rgba(102, 126, 234, 0.7)',
    haloAlt: 'rgba(241, 196, 15, 0.55)',
    faceStroke: 'rgba(245, 238, 255, 0.95)'
  });
}

class FakeStyle {
  constructor() {
    this._properties = new Map();
  }

  setProperty(name, value) {
    if (value === undefined || value === null || value === '') {
      this._properties.delete(name);
    } else {
      this._properties.set(name, String(value));
    }
  }

  removeProperty(name) {
    this._properties.delete(name);
  }

  getPropertyValue(name) {
    return this._properties.get(name) ?? '';
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this._classes = new Set();
  }

  _sync() {
    this.element._className = Array.from(this._classes).join(' ');
  }

  add(...tokens) {
    tokens.forEach((token) => {
      if (token) {
        this._classes.add(token);
      }
    });
    this._sync();
  }

  remove(...tokens) {
    tokens.forEach((token) => {
      this._classes.delete(token);
    });
    this._sync();
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this._classes.has(token)) {
        this._classes.delete(token);
        this._sync();
        return false;
      }
      this._classes.add(token);
      this._sync();
      return true;
    }
    if (force) {
      this._classes.add(token);
    } else {
      this._classes.delete(token);
    }
    this._sync();
    return !!force;
  }

  contains(token) {
    return this._classes.has(token);
  }

  forEach(callback) {
    Array.from(this._classes).forEach(callback);
  }

  toString() {
    return this.element._className || '';
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this._className = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
    if (name === 'class') {
      this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
      this.classList = new FakeClassList(this);
      this._classes.forEach((cls) => this.classList.add(cls));
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    const matcher = createMatcher(selector);
    return depthFirstSearch(this, matcher);
  }

  getContext() {
    return null;
  }
}

function createMatcher(selector) {
  selector = selector.trim();
  if (!selector) {
    return () => false;
  }
  if (selector.startsWith('.')) {
    const className = selector.slice(1);
    return (element) => element.classList.contains(className);
  }
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return (element) => element.getAttribute('id') === id;
  }
  return (element) => element.tagName.toLowerCase() === selector.toLowerCase();
}

function depthFirstSearch(root, matcher) {
  for (const child of root.children) {
    if (matcher(child)) {
      return child;
    }
    const found = depthFirstSearch(child, matcher);
    if (found) return found;
  }
  return null;
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.hidden = false;
    this._listeners = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

function withFakeDom(callback) {
  const document = new FakeDocument();
  const window = {
    document,
    matchMedia: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; }
    })
  };

  const previousDescriptors = {
    document: Object.getOwnPropertyDescriptor(global, 'document'),
    window: Object.getOwnPropertyDescriptor(global, 'window'),
    navigator: Object.getOwnPropertyDescriptor(global, 'navigator'),
    matchMedia: Object.getOwnPropertyDescriptor(global, 'matchMedia'),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(global, 'requestAnimationFrame'),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(global, 'cancelAnimationFrame')
  };

  Object.defineProperty(global, 'document', { configurable: true, enumerable: true, writable: true, value: document });
  Object.defineProperty(global, 'window', { configurable: true, enumerable: true, writable: true, value: window });
  Object.defineProperty(global, 'navigator', { configurable: true, enumerable: true, writable: true, value: { userAgent: 'fake' } });
  Object.defineProperty(global, 'matchMedia', { configurable: true, enumerable: true, writable: true, value: window.matchMedia });
  Object.defineProperty(global, 'requestAnimationFrame', { configurable: true, enumerable: true, writable: true, value: () => 0 });
  Object.defineProperty(global, 'cancelAnimationFrame', { configurable: true, enumerable: true, writable: true, value: () => {} });

  const restore = (name) => {
    const descriptor = previousDescriptors[name];
    if (descriptor) {
      Object.defineProperty(global, name, descriptor);
    } else {
      delete global[name];
    }
  };

  try {
    callback({ document, window });
  } finally {
    restore('document');
    restore('window');
    restore('navigator');
    restore('matchMedia');
    restore('requestAnimationFrame');
    restore('cancelAnimationFrame');
  }
}

function getStyleValue(element, name) {
  return element.style.getPropertyValue(name).trim();
}

function testPlanetBubbleMoods() {
  const originalDetectWebGL = PlanetBubble.prototype.detectWebGL;
  try {
    withFakeDom(({ document }) => {
      PlanetBubble.prototype.detectWebGL = () => false;
      const container = document.createElement('div');
      document.body.appendChild(container);

      const planet = new PlanetBubble(container, { size: 72 });

      const expectedPrimary = {
        focused: 'rgba(59, 130, 246, 0.88)',
        distracted: 'rgba(255, 94, 58, 0.88)',
        idle: 'rgba(184, 190, 201, 0.82)'
      };

      for (const [mood, expected] of Object.entries(expectedPrimary)) {
        planet.setMood(mood);
        assert.strictEqual(getStyleValue(container, '--planet-primary'), expected, `Primary color mismatch for ${mood}`);
      }

      planet.setMood('focused');
      planet.setPaletteOverride({
        colors: {
          primary: 'rgba(255, 149, 64, 0.88)',
          secondary: 'rgba(255, 102, 0, 0.7)',
          base: 'rgba(92, 32, 4, 0.95)'
        }
      });

      assert.strictEqual(getStyleValue(container, '--planet-primary'), 'rgba(255, 149, 64, 0.88)');
      assert.strictEqual(getStyleValue(container, '--planet-secondary'), 'rgba(255, 102, 0, 0.7)');
      assert.strictEqual(getStyleValue(container, '--planet-tertiary'), 'rgba(92, 32, 4, 0.95)');

      planet.destroy();
    });
  } finally {
    PlanetBubble.prototype.detectWebGL = originalDetectWebGL;
  }
}

function main() {
  testDomainPalettes();
  testPlanetBubbleMoods();
  console.log('Palette tests passed');
}

main();
