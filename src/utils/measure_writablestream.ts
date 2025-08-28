import { createWriteStream } from "fs";
let filePath = "./test_writestream.out";

function measureTimeUsingConsoleWithStream() {
    console.time("CREATE WRITE FILE STREAM (console.time)")
    let writableStream = createWriteStream(filePath);
    writableStream.on('error', (error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
    console.timeEnd("CREATE WRITE FILE STREAM (console.time)")

    console.time("WRITE ONE MESSAGE TO FILE STREAM (console.time)")
    if (writableStream != null) {
        writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit.");
    }
    console.timeEnd("WRITE ONE MESSAGE TO FILE STREAM (console.time)")

    console.time("WRITE 10 MESSAGES TO FILE STREAM (console.time)")
    for (let i = 0; i < 10; i++) {
        if (writableStream != null) {
            writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit");
        }
    }
    console.timeEnd("WRITE 10 MESSAGES TO FILE STREAM (console.time)")
    writableStream.end();

    console.time("CREATE A WRITE FILE STREAM AND WRITE ONE MESSAGE (console.time)")
    let oneOffWritableStream = createWriteStream(filePath);
    oneOffWritableStream.on('error', (error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
    if (writableStream != null) {
        writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit");
    }
    oneOffWritableStream.end();
    console.timeEnd("CREATE A WRITE FILE STREAM AND WRITE ONE MESSAGE (console.time)")
}

function measureTimeUsingPerformanceWithStream() {
    let timerStart = performance.now();
    let writableStream = createWriteStream(filePath);
    writableStream.on('error', (error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
    console.log("CREATE WRITE FILE STREAM (performance)", performance.now() - timerStart);

    timerStart = performance.now();
    if (writableStream != null) {
        writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit.");
    }
    console.log("WRITE ONE MESSAGE TO FILE STREAM (performance)", performance.now() - timerStart);

    timerStart = performance.now();
    for (let i = 0; i < 10; i++) {
        if (writableStream != null) {
            writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit");
        }
    }
    console.log("WRITE 10 MESSAGES TO FILE STREAM (performance)", performance.now() - timerStart)
    writableStream.end();

    timerStart = performance.now();
    let oneOffWritableStream = createWriteStream(filePath);
    oneOffWritableStream.on('error', (error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
    if (writableStream != null) {
        writableStream.write("Lorem ipsum dolor sit amet consectetur adipiscing elit");
    }
    oneOffWritableStream.end();
    console.log("CREATE A WRITE FILE STREAM AND WRITE ONE MESSAGE (performance)", performance.now() - timerStart)
}

function measureTimeUsingConsoleWithConsole() {
    console.time("WRITE 10 MESSAGES USING CONSOLE.LOG (console.time)")
    for (let i = 0; i < 10; i++) {
        console.log("Lorem ipsum dolor sit amet consectetur adipiscing elit.");
    }
    console.timeEnd("WRITE 10 MESSAGES USING CONSOLE.LOG (console.time)")
}

function measureTimeUsingPerformanceWithConsole() {
    let timerStart = performance.now();
    for (let i = 0; i < 10; i++) {
        console.log("Lorem ipsum dolor sit amet consectetur adipiscing elit.");
    }
    console.log("WRITE 10 MESSAGES USING CONSOLE.LOG (performance)", (performance.now() - timerStart)/1000)
}

measureTimeUsingConsoleWithStream();
measureTimeUsingPerformanceWithStream();
measureTimeUsingConsoleWithConsole();
measureTimeUsingPerformanceWithConsole();