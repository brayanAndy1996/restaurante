import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Con la máquina cargada (CI, otras suites en paralelo) las esperas de 1 s por defecto son frágiles.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});

// jsdom todavía no implementa <dialog>.showModal()/close(): se simulan con el atributo `open`.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// matchMedia tampoco existe en jsdom: por defecto, pantalla de celular.
if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Cada prueba empieza sin sesión ni tokens guardados.
import { beforeEach } from 'vitest';
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
