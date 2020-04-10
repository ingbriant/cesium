import Cartesian3 from './Cartesian3';

/**
 * Print something with TypeScript
 *
 * @exports helloTypescript
 *
 * @param {Cartesian3} cartesian It's a Cartesian3.
 * @param {string} val Any string you want.
 *
 * @example
 * helloTypescript(new Cartesian3(4, 5, 6), 'squirrel!')
 */
export default function helloTypescript(cartesian: Cartesian3, val: string) {
    console.log(`${cartesian.toString()} ${val}`);
}
