import { parse } from 'csv-parse';
import fs from 'fs/promises';

let logFile = process.argv[2];

const logContent = await fs.readFile(logFile, "utf8");
const parsedOutput = parse(logContent, {
    trim: true,
    columns: true,
},
function (err, records) {
    records.forEach((record, idx) => {
        if (record.data_type === 'ms' || record.data_type === 'us') {
            let value = record.value;
            let s:number, sss:number;
            if (record.data_type === 'ms') {
                s = Math.floor(value / 1000);
                sss = Math.round(value % 1000);
            } else {
                s = Math.floor(value / 1000000);
                sss = Math.round(value % 1000000);
            }
            let m = Math.floor(s / 60);
            s = Math.round(s % 60);
            let h = Math.floor(m / 60);
            m = Math.round(m % 60 );
            console.log(record.src_file, '|', record.data, '|', h + ':' + m + ':' + s + '.' + sss);
        }
    })
},
);