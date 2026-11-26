import { HSI_SIZE, type Size } from '../config/display';
import type { Craft } from '../sim/state';
import type { Airport } from '../sim/world/airport';
import { hsiOrigin, panelOrigin } from '../views/instruments';
import { airportOrder, airportPage, runwayChoices, runwayEnd, sameSelection, type RunwaySelection } from '../views/runwaySelect';

export interface RunwayMenuOptions {
  readonly airports: readonly Airport[];
  /** The instruments canvas and its internal size. */
  readonly canvas: HTMLCanvasElement;
  size(): Size;
  craft(): Pick<Craft, 'x' | 'y' | 'heading'>;
  destination(): string | null;
  /** The picked end changed. */
  onChange(): void;
}

export interface RunwayMenu {
  readonly selected: RunwaySelection | null;
  /** Lays the HSI button and an open menu over the panel again. */
  place(): void;
}

/**
 * The runway selector: a button over the HSI that opens a floating menu of airports and runway ends. The menu
 * sits above the instrument block, so it covers no flight instrument. Real buttons, so the flight keys keep working.
 */
export function createRunwayMenu(o: RunwayMenuOptions): RunwayMenu {
  let selected: RunwaySelection | null = null;
  let open = false;
  let order: string[] = [];
  let page = 0;
  let airport = '';

  const make = (tag: 'button' | 'div' | 'span', className: string, text = ''): HTMLElement => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    if (el instanceof HTMLButtonElement) el.type = 'button';
    return el;
  };

  const opener = make('button', 'hsi-button');
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.title = 'Select runway';
  o.canvas.parentElement?.append(opener);

  const menu = make('div', 'runway-menu');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Select runway');
  menu.hidden = true;
  document.body.append(menu);

  const describe = (): void => {
    const end = runwayEnd(o.airports, selected);
    opener.setAttribute('aria-label', end ? `Select runway, now ${end.ident} ${end.name}` : 'Select runway, none selected');
    opener.setAttribute('aria-expanded', String(open));
  };

  const place = (): void => {
    const size = o.size();
    const scale = o.canvas.clientWidth / size.width;
    const [x, y] = hsiOrigin(size);
    opener.style.left = `${o.canvas.offsetLeft + x * scale}px`;
    opener.style.top = `${o.canvas.offsetTop + y * scale}px`;
    opener.style.width = opener.style.height = `${HSI_SIZE * scale}px`;
    if (!open) return;
    const rect = o.canvas.getBoundingClientRect();
    const center = rect.left + (x + HSI_SIZE / 2) * scale;
    const left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, center - menu.offsetWidth / 2));
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, rect.top + panelOrigin(size).top * scale - menu.offsetHeight - 6)}px`;
  };

  /** `keyboard`: hand focus back to the HSI button; after a mouse click, leave nothing focused. */
  const close = (keyboard: boolean): void => {
    open = false;
    menu.hidden = true;
    describe();
    if (keyboard) opener.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  };

  const button = (key: string, label: string, onClick: (keyboard: boolean) => void, pressed?: boolean): HTMLButtonElement => {
    const el = make('button', 'runway-menu-button', label) as HTMLButtonElement;
    el.dataset['key'] = key;
    if (pressed !== undefined) el.setAttribute('aria-pressed', String(pressed));
    // `detail` is 0 for a click made with the keyboard.
    el.addEventListener('click', (e) => onClick(e.detail === 0));
    return el;
  };

  const row = (label: string, ...children: HTMLElement[]): HTMLElement => {
    const el = make('div', 'runway-menu-row');
    el.append(make('span', 'runway-menu-label', label), ...children);
    return el;
  };

  const select = (sel: RunwaySelection | null, keyboard: boolean): void => {
    selected = sel;
    close(keyboard);
    o.onChange();
  };

  const render = (): void => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset['key'];
    const shown = airportPage(order, page);
    const airports = shown.items.map((ident) =>
      button(`airport-${ident}`, ident, () => {
        airport = ident;
        render();
      }, ident === airport),
    );
    if (shown.back || shown.forward) {
      const step = (by: number, key: string, label: string, enabled: boolean): HTMLButtonElement => {
        const el = button(key, label, () => {
          page = shown.start + by;
          render();
        });
        el.disabled = !enabled;
        el.setAttribute('aria-label', key === 'back' ? 'Earlier airports' : 'More airports');
        return el;
      };
      airports.unshift(step(-1, 'back', '<', shown.back));
      airports.push(step(1, 'forward', '>', shown.forward));
    }

    const here = o.airports.find((a) => a.ident === airport);
    const runways = (here ? runwayChoices(here) : []).map(({ selection, name }) =>
      button(`runway-${name}`, name, (keyboard) => select(selection, keyboard), sameSelection(selection, selected)),
    );

    const clear = button('clear', 'CLEAR', (keyboard) => select(null, keyboard));
    clear.disabled = selected === null;
    const shut = button('close', 'X', (keyboard) => close(keyboard));
    shut.setAttribute('aria-label', 'Close');

    const title = make('div', 'runway-menu-row runway-menu-title');
    title.append(make('span', '', 'APPROACH'), shut);
    const foot = make('div', 'runway-menu-row');
    foot.append(clear);
    menu.replaceChildren(title, row('APT', ...airports), row('RWY', ...runways), foot);
    if (focused) menu.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
    place();
  };

  opener.addEventListener('click', (e) => {
    if (open) {
      close(e.detail === 0);
      return;
    }
    open = true;
    menu.hidden = false;
    order = airportOrder(o.airports, o.craft(), o.destination());
    airport = selected?.ident ?? order[0] ?? '';
    page = Math.max(0, order.indexOf(airport));
    describe();
    render();
    if (e.detail === 0) menu.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    else opener.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (open && e.code === 'Escape') close(menu.contains(document.activeElement));
  });
  window.addEventListener('resize', place);

  describe();
  place();
  return {
    get selected() {
      return selected;
    },
    place,
  };
}
