import { createWriteStream } from "fs";

let writableStream = null;

export function createStreamForWriting(filePath: string) {
    writableStream = createWriteStream(filePath);
    writableStream.on('error', (error) => {
        process.stderr.write(`An error occured during the write to file: ${filePath} Error: ${error.message}`)
    })
}

export function log(text: string) {
    console.log(text)
    if (writableStream != null) {
        writableStream.write(text)
    }
}

export function endWritingStream() {
    writableStream.end()
}
