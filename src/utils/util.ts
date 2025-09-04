import { createWriteStream } from "fs";

let writableStream = null;
let debug = false;
export const DEBUG = false;

// Output from measure_writablestream.ts suggests that it is more efficient
// to create a write stream at the beginning of program (i.e. as a one-off) and 
// write log messages to it instead of calling console.log and then pipe to a file using 
// shell commands.
export function logStreamStart(filePath: string) {
    writableStream = createWriteStream(filePath, {flags: 'a'});
    writableStream.on('error', (error:Error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
}

export function log(text: string) {
    if (writableStream != null) {
        writableStream.write(text)
    } else {
        console.error(`Trying to write ${text} to a file stream but the stream has not been set up, it is currently null`);
    }
}

export function debugLog(text: string) {
    if (writableStream != null && debug == true) {
        writableStream.write(text)
    }
}

export function logStreamStop(filePath: string) {
    if (writableStream != null) {
        writableStream.end()
    }else {
        console.error(`Trying to end the ${filePath} file stream that has not been set up, it is currently null`);
    }
}
