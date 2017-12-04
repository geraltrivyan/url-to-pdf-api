const puppeteer = require('puppeteer');
const _ = require('lodash');
const config = require('../config');
const logger = require('../util/logger')(__filename);

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function render(_opts = {}) {
  const opts = _.merge({
    cookies: [],
    scrollPage: false,
    emulateScreenMedia: true,
    ignoreHttpsErrors: false,
    html: null,
    viewport: {
      width: 1600,
      height: 1200,
    },
    goto: {
      waitUntil: 'networkidle',
      networkIdleTimeout: 2000,
    },
    pdf: {
      format: 'A4',
      printBackground: true,
    },
  }, _opts);

  if (_.get(_opts, 'pdf.width') && _.get(_opts, 'pdf.height')) {
    // pdf.format always overrides width and height, so we must delete it
    // when user explicitly wants to set width and height
    opts.pdf.format = undefined;
  }

  logOpts(opts);

  const browser = await puppeteer.launch({
    headless: !config.DEBUG_MODE,
    ignoreHTTPSErrors: opts.ignoreHttpsErrors,
    args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'],
    sloMo: config.DEBUG_MODE ? 250 : undefined,
  });
  const page = await browser.newPage();

  page.on('console', (...args) => logger.info('PAGE LOG:', ...args));

  page.on('error', (err) => {
    logger.error(`Error event emitted: ${err}`);
    logger.error(err.stack);
    browser.close();
  });

  let data;
  try {
    logger.info('Set browser viewport..');
    await page.setViewport(opts.viewport);
    if (opts.emulateScreenMedia) {
      logger.info('Emulate @media screen..');
      await page.emulateMedia('screen');
    }

    logger.info('Setting cookies..');
    opts.cookies.map(async (cookie) => {
      await page.setCookie(cookie);
    });

    if (opts.html) {
      logger.info('Set HTML ..');
      // https://github.com/GoogleChrome/puppeteer/issues/728
      await page.goto(`data:text/html,${opts.html}`, opts.goto);
    } else {
      logger.info(`Goto url ${opts.url} ..`);
      await page.goto(opts.url, opts.goto);
    }

    if (_.isNumber(opts.waitFor) || _.isString(opts.waitFor)) {
      logger.info(`Wait for ${opts.waitFor} ..`);
      await page.waitFor(opts.waitFor);
    }

    if (opts.scrollPage) {
      logger.info('Scroll page ..');
      await scrollPage(page);
    }

    logger.info('Render PDF ..');
    if (config.DEBUG_MODE) {
      const msg = `\n\n---------------------------------\n
        Chrome does not support PDF rendering in "headed" mode.
        See this issue: https://github.com/GoogleChrome/puppeteer/issues/576
        \n---------------------------------\n\n
      `;
      throw new Error(msg);
    }

    console.log('-------------');
    let reportPagesCount = 1, reportCountPrev;
    let currentTime = new Date().getTime();
    let timeDif = 0;
    while(reportPagesCount > 0) {
        reportCountPrev = reportPagesCount;
        reportPagesCount = await page.evaluate(function() {
          if(reportGenerateHelper){
              return Object.keys(reportGenerateHelper.reportPages).length;
          } else {
              return 0;
          }
        });
        if(reportCountPrev === reportPagesCount) {//IF we stack on reports drawing, check time
            timeDif = new Date().getTime() - currentTime;
            if(timeDif > 30 * 1000) {
                logger.error(`Error when rendering page: Cannot finish ${reportPagesCount} reports drawing.`);
                break;
            }
        }
        await sleep(1000);
    }
    opts.pdf.height = await page.evaluate(() =>  document.body.offsetHeight) + 'px';
    console.log('PDF calculated Height: ' + opts.pdf.height);
    console.log('-------------');
    data = await page.pdf(opts.pdf);
  } catch (err) {
    logger.error(`Error when rendering page: ${err}`);
    logger.error(err.stack);
    throw err;
  } finally {
    logger.info('Closing browser..');
    if (!config.DEBUG_MODE) {
      await browser.close();
    }
  }

  return data;
}

async function scrollPage(page) {
  // Scroll to page end to trigger lazy loading elements
  await page.evaluate(() => {
    const scrollInterval = 100;
    const scrollStep = Math.floor(window.innerHeight / 2);
    const bottomThreshold = 400;

    function bottomPos() {
      return window.pageYOffset + window.innerHeight;
    }

    return new Promise((resolve, reject) => {
      function scrollDown() {
        window.scrollBy(0, scrollStep);

        if (document.body.scrollHeight - bottomPos() < bottomThreshold) {
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
          return;
        }

        setTimeout(scrollDown, scrollInterval);
      }

      setTimeout(reject, 30000);
      scrollDown();
    });
  });
}

function logOpts(opts) {
  const supressedOpts = _.cloneDeep(opts);
  if (opts.html) {
    supressedOpts.html = '...';
  }

  logger.info(`Rendering with opts: ${JSON.stringify(supressedOpts, null, 2)}`);
}

module.exports = {
  render,
};
