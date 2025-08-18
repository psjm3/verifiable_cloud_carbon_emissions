import * as crypto from "crypto";
import fs from 'fs/promises';

import { Field, Signature } from "o1js";
import { MeterReading, SignedMeterReading, SmartMeterProperties } from "../types/meter_readings.js";

export class SmartMeterData {
    generateReadings(timestampsFrom: Field[], lastTimestamp: Field): MeterReading[] {
        let meterReadings: MeterReading[] = [];

        let accumulatedReading = 0;


        for (let i = 0; i < timestampsFrom.length+1; i++) {
            accumulatedReading = accumulatedReading + (crypto.randomInt(40000, 50000)); //kWh per half an hour, which equate to 80-100MW

            if (i < timestampsFrom.length) {
                meterReadings.push(new MeterReading({
                    meterReading: Field(accumulatedReading), 
                    timestamp: Field(timestampsFrom[i])
                }));
            } else {
                meterReadings.push(new MeterReading({
                    meterReading: Field(accumulatedReading), 
                    timestamp: Field(lastTimestamp)
                }));
            }
        }
        // We need to generate one more meter reading than the carbon intensity factors because the intensity
        // is between two timestamps, whilst a meter reading is the reading at a given timestamp.
        // The last timestamp would be 60 mins after the start time of the last intensity because
        // each 
        // accumulatedReading = accumulatedReading + (crypto.randomInt(0, 2000)); //kWh
        // meterReadings.push(new MeterReading({
        //         meterReading: Field(accumulatedReading), 
        //         timestamp: lastTimestamp
        //     }));
        return meterReadings;
    }
    async getSmartMeterProperties(smartMeterId: Field) {
        const smartMeterPropsRaw = await fs.readFile('./generated_smart_meters/properties_' + smartMeterId.toString() + '.json', 'utf8');
        const smartMeterProps = SmartMeterProperties.fromJSON(JSON.parse(smartMeterPropsRaw));
        return smartMeterProps;
    }

    async signSmartMeterReadings(smartMeterId: Field, timestampsFrom: Field[], lastTimestamp: Field): Promise<SignedMeterReading[]> {

        const smartMeterProps = await this.getSmartMeterProperties(smartMeterId);
                
        // Generate half-hourly readings to match with the carbon intensity frequencies
        const meterReadings: MeterReading[] = this.generateReadings(timestampsFrom, lastTimestamp);

        let signedMeterReadings: SignedMeterReading[] = [];
        meterReadings.forEach((reading) => {
            const meterReadingSig: Signature = Signature.create(
                smartMeterProps.secretKey, smartMeterProps.publicKey.toFields().concat(
                    [reading.meterReading, reading.timestamp])
                );

            signedMeterReadings.push(new SignedMeterReading({
                meterReadingData: reading,
                meterReadingSig: meterReadingSig,
            }));
        });

        return signedMeterReadings;
    }
}