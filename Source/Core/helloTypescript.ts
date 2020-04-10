import Cartesian3 from './Cartesian3';

export default function helloTypescript(num: number, val: string) {
    const cart = new Cartesian3(num, num, num);
    console.log(`${cart.toString()} ${val}`);
}
