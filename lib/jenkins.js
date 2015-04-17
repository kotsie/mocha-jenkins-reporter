/**
 * Module dependencies.
 */

var Base = require('mocha').reporters.Base
    , cursor = Base.cursor
    , color = Base.color
    , fs = require('fs')
    , path = require('path')
    , diff = require('diff');

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */

var Date = global.Date
    , setTimeout = global.setTimeout
    , setInterval = global.setInterval
    , clearTimeout = global.clearTimeout
    , clearInterval = global.clearInterval;

/**
 * Expose `Jenkins`.
 */

exports = module.exports = Jenkins;

/**
 * Initialize a new `Jenkins` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */

function Jenkins(runner) {
    Base.call(this, runner);
    var self = this;
    var fd = {};
    var currentSuite, reportPath, isDirectory;


    function writeString(str, fd) {
        if (fd) {
            var buf = new Buffer(str);
            fs.writeSync(fd, buf, 0, buf.length, null);
        }
    }

    function genSuiteReport(currentSuite, currentFd) {
        var testCount = currentSuite.failures + currentSuite.passes;
        if (currentSuite.tests.length > testCount) {
            // we have some skipped suites included
            testCount = currentSuite.tests.length;
        }
        if (testCount === 0) {
            // no tests, we can safely skip printing this suite
            return;
        }

        writeString('<testsuite', currentFd);
        writeString(' name="' + htmlEscape(currentSuite.suite.fullTitle()) + '"', currentFd);
        writeString(' tests="' + testCount + '"', currentFd);
        writeString(' failures="' + currentSuite.failures + '"', currentFd);
        writeString(' skipped="' + (testCount - currentSuite.failures - currentSuite.passes) + '"', currentFd);
        writeString(' timestamp="' + currentSuite.start.toUTCString() + '"', currentFd);
        writeString(' time="' + (currentSuite.duration / 1000) + '"', currentFd);
        writeString('>\n', currentFd);

        if (currentSuite.tests.length === 0 && currentSuite.failures > 0) {
            writeString('<testcase', currentFd);
            writeString(' classname="' + htmlEscape(currentSuite.suite.fullTitle()) + '"', currentFd);
            writeString(' name="' + htmlEscape(currentSuite.suite.fullTitle()) + ' before"', currentFd);
            writeString('>\n', currentFd);
            writeString('<failure message="Failed during before hook"/>', currentFd);
            writeString('</testcase>\n', currentFd);
        } else {
            currentSuite.tests.forEach(function (test) {
                writeString('<testcase', currentFd);
                writeString(' classname="' + getClassName(test, currentSuite.suite) + '"', currentFd);
                writeString(' name="' + htmlEscape(test.title) + '"', currentFd);
                writeString(' time="' + (test.duration / 1000) + '"', currentFd);
                if (test.state == "failed") {
                    writeString('>\n', currentFd);
                    writeString('<failure message="', currentFd);
                    if (test.err.message) writeString(htmlEscape(test.err.message));
                    writeString('">\n', currentFd);
                    writeString(htmlEscape(unifiedDiff(test.err)));
                    writeString('\n</failure>\n', currentFd);
                    writeString('</testcase>\n', currentFd);
                } else if (test.state === undefined) {
                    writeString('>\n', currentFd);
                    writeString('<skipped/>\n', currentFd);
                    writeString('</testcase>\n', currentFd);
                } else {
                    writeString('/>\n', currentFd);
                }
            });
        }

        writeString('</testsuite>\n', currentFd);
    }

    function startSuite(suite) {

        var suiteName = suite.fullTitle();
        var suiteNameSlug = suiteName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
        var currentFd = null;
        if (isDirectory && suiteNameSlug) {
            fd[suiteNameSlug] = fs.openSync(path.join(reportPath, suiteNameSlug + ".xml"), 'w');
            currentFd = fd[suiteNameSlug];
        }

        writeString('<testsuites name="' + (process.env.JUNIT_REPORT_NAME || 'Mocha Tests') + '">\n', currentFd);

        currentSuite = {
            id: suiteNameSlug,
            suite: suite,
            tests: [],
            start: new Date,
            failures: 0,
            passes: 0
        };
        console.log();
        console.log("  " + suiteName);
    }

    function endSuite() {
        if (currentSuite != null) {
            var tempSuite = currentSuite;
            currentSuite = null;
            var currentFd = fd[tempSuite.id];
            delete fd[tempSuite.id];
            tempSuite.duration = new Date - tempSuite.start;
            console.log();
            console.log('  Suite duration: ' + (tempSuite.duration / 1000) + ' s, Tests: ' + tempSuite.tests.length);
            try {
                genSuiteReport(tempSuite, currentFd);
            } catch (err) {
                console.log(err)
            }
            writeString('</testsuites>\n', currentFd);
            if (currentFd) {
                fs.closeSync(currentFd);
            }
        }
    }

    function addTestToSuite(test) {
        currentSuite.tests.push(test);
    }

    function indent() {
        return "    ";
    }

    function htmlEscape(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function unifiedDiff(err) {
        function escapeInvisibles(line) {
            return line.replace(/\t/g, '<tab>')
                .replace(/\r/g, '<CR>')
                .replace(/\n/g, '<LF>\n');
        }

        function cleanUp(line) {
            if (line.match(/\@\@/)) return null;
            if (line.match(/\\ No newline/)) return null;
            return escapeInvisibles(line);
        }

        function notBlank(line) {
            return line != null;
        }

        var actual = err.actual,
            expected = err.expected;

        var lines, msg = '';

        if (err.actual && err.expected) {
            // make sure actual and expected are strings
            if (!(typeof actual === 'string' || actual instanceof String)) {
                actual = JSON.stringify(err.actual);
            }

            if (!(typeof expected === 'string' || expected instanceof String)) {
                expected = JSON.stringify(err.actual);
            }

            msg = diff.createPatch('string', actual, expected);
            lines = msg.split('\n').splice(4);
            msg += lines.map(cleanUp).filter(notBlank).join('\n');
        }

        if (process.env.JUNIT_REPORT_STACK && err.stack) {
            if (msg) msg += '\n';
            lines = err.stack.split('\n').slice(1);
            msg += lines.map(cleanUp).filter(notBlank).join('\n');
        }

        return msg;
    }

    function getClassName(test, suite) {
        var title = suite.fullTitle();
        if (process.env.JENKINS_REPORTER_ENABLE_SONAR) {
            // Inspired by https://github.com/pghalliday/mocha-sonar-reporter
            var relativeTestDir = process.env.JENKINS_REPORTER_TEST_DIR || 'test',
                absoluteTestDir = path.join(process.cwd(), relativeTestDir),
                relativeFilePath = path.relative(absoluteTestDir, test.file),
                fileExt = path.extname(relativeFilePath);
            title = relativeFilePath.replace(new RegExp(fileExt + "$"), '');
        }
        return htmlEscape(title);
    }

    runner.on('start', function () {
        reportPath = process.env.JUNIT_REPORT_PATH;
        if (reportPath) {
            if (!fs.existsSync(reportPath) || !fs.statSync(reportPath).isDirectory()) {
                reportPath = path.dirname(reportPath);
            }
            isDirectory = fs.existsSync(reportPath) && fs.statSync(reportPath).isDirectory();
        }
    });

    runner.on('end', function () {
        if (currentSuite) {
            endSuite();
        }
        self.epilogue.call(self);
    });

    runner.on('suite', function (suite) {
        if (currentSuite) {
            endSuite();
        }
        startSuite(suite);
    });


    runner.on('test end', function (test) {
        addTestToSuite(test);
    });

    runner.on('pending', function (test) {
        var fmt = indent()
            + color('checkmark', '  -')
            + color('pending', ' %s');
        console.log(fmt, test.title);
    });

    runner.on('pass', function (test) {
        currentSuite.passes++;
        var fmt = indent()
            + color('checkmark', '  ' + Base.symbols.dot)
            + color('pass', ' %s: ')
            + color(test.speed, '%dms');
        console.log(fmt, test.title, test.duration);
    });

    runner.on('fail', function (test, err) {
        var n = ++currentSuite.failures;
        var fmt = indent()
            + color('fail', '  %d) %s');
        console.log(fmt, n, test.title);
    });
}

Jenkins.prototype.__proto__ = Base.prototype;
