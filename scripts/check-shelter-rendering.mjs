import { checkBrowserFixture } from './check-browser-fixture.mjs';

await checkBrowserFixture('shelter-rendering.html', 'Shelter and terrain GPU checks', [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
]);
