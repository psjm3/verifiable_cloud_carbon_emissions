// We obtain the carbon intensity factors for Great Britain via an API developed by 
// the National Energy System Operator (NESO, https://api.carbonintensity.org.uk/). 
// We use a specific time range that covers the reporting period.
export type NationalIntensity = {
    from: string,
    to: string,
    intensity: {
        forecast: number,
        actual: number,
        index: string
    }
};

type BadRequest = {
    code: "bad_request",
    message: string
};

type ApiResponse =
    | (Omit<Response, "json"> & {
        status: 200,
        json: () => NationalIntensity | PromiseLike<NationalIntensity>
    })
    | (Omit<Response, "json"> & {
        status: 400,
        json: () => BadRequest | PromiseLike<BadRequest>
    });

export class CarbonIntensityData {
    async getIntensityFactors(fromTimestamp: number, toTimestamp: number): Promise<NationalIntensity[]> {
        const headers = {
            'Accept': 'application/json'
        };

        const marshalResponse = (resp: ApiResponse) => {
            if (resp.status === 200) return resp.json();
            if (resp.status === 400) return resp.json();
            return Error("Unhandled response code");
        }

        const responseHandler = (resp: Response) => {
            const r = resp as ApiResponse;
            return marshalResponse(r);
        }

        const from = new Date(fromTimestamp).toISOString();
        const to = new Date(toTimestamp).toISOString();

        const resp = await fetch('https://api.carbonintensity.org.uk/intensity/' + from + '/' + to, {
            method: 'GET',
            headers: headers
        });

        const respContent = await responseHandler(resp);

        // We can make use of the actual intensity data obtained half-hourly.
        let intensityArray: NationalIntensity[] = [];
        for (let i = 0; i < respContent["data"].length; i++) {
            intensityArray[i] = respContent["data"][i];
        }
        return intensityArray;
    }
}