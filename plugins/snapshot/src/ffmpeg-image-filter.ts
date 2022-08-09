import { addVideoFilterArguments } from '@scrypted/common/src/ffmpeg-helpers';
import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import { sleep } from '@scrypted/common/src/sleep';
import child_process, { ChildProcess } from 'child_process';
import { once } from 'events';
import { Writable } from 'stream';
import { Pipe2Jpeg } from './pipe2jpeg';

export interface FFmpegImageFilterOptions {
    blur?: boolean;
    brightness?: number;
    ffmpegPath?: string;
    text?: {
        text: string;
        fontFile: string;
    };
    timeout?: number;

    resize?: {
        fractional?: boolean;
        width?: number;
        height?: number;
    };

    crop?: {
        fractional?: boolean;
        left: number;
        top: number;
        width: number;
        height: number;
    };

    time?: number;
}

function ffmpegCreateOutputArguments(inputArguments: string[], options: FFmpegImageFilterOptions) {
    if (options.crop) {
        const { crop } = options;

        const left = crop.fractional ? `iw*${crop.left}` : crop.left;
        const top = crop.fractional ? `ih*${crop.top}` : crop.top;
        const width = crop.fractional ? `iw*${crop.width}` : crop.width;
        const height = crop.fractional ? `ih*${crop.height}` : crop.height;

        const filter = `crop=${width}:${height}:${left}:${top}`;
        addVideoFilterArguments(inputArguments, filter, 'snapshotCrop');
    }

    if (options.resize) {
        const { resize } = options;
        let width = !resize.width ? '-2' : (resize.fractional ? `iw*${resize.width}` : resize.width);
        let height = !resize.height ? '-2' : (resize.fractional ? `ih*${resize.height}` : resize.height);

        const filter = `scale=${width}:${height}`;
        addVideoFilterArguments(inputArguments, filter, 'snapshotResize');
    }

    if (options.brightness) {
        addVideoFilterArguments(inputArguments, `eq=brightness=${options.brightness}`, 'snapshotEq');
    }

    if (options.blur) {
        addVideoFilterArguments(inputArguments, 'gblur=sigma=25', 'snapshotBlur');
    }

    if (options.text) {
        const { text } = options;
        addVideoFilterArguments(inputArguments,
            `drawtext=fontfile=${text.fontFile}:text='${text.text}':fontcolor=white:fontsize=h/8:x=(w-text_w)/2:y=(h-text_h)/2`,
            'snapshotText');
    }

    // console.log(inputArguments);
}

export async function ffmpegFilterImageBuffer(inputJpeg: Buffer, options: FFmpegImageFilterOptions) {
    const inputArguments = [
        '-i', 'pipe:4',
    ];

    ffmpegCreateOutputArguments(inputArguments, options);
    const outputArguments = [
        '-frames:v', '1',
        '-f', 'image2',
        'pipe:3',
    ];
    const args: string[] = [
        '-hide_banner',
        '-y',
        ...inputArguments,

        ...outputArguments,
    ];

    const cp = child_process.spawn(options.ffmpegPath || 'ffmpeg',
        args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    });
    const input = cp.stdio[4] as Writable;
    input.write(inputJpeg);
    input.end();

    return ffmpegFilterImageInternal(cp, options);
}

export async function ffmpegFilterImage(inputArguments: string[], options: FFmpegImageFilterOptions) {
    ffmpegCreateOutputArguments(inputArguments, options);

    let outputArguments: string[];
    if (options.time) {
        outputArguments = [
            '-vsync', '0',
            '-f', 'image2pipe',
            'pipe:3',
        ];
    }
    else {

        outputArguments = [
            '-frames:v', '1',
            '-f', 'image2',
            'pipe:3',
        ];

    }

    const args: string[] = [
        '-hide_banner',
        '-y',
        ...inputArguments,

        ...outputArguments,
    ];

    // console.log(args);

    const cp = child_process.spawn(options.ffmpegPath || 'ffmpeg',
        args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    if (options.time)
        return ffmpegFilterImageStream(cp, options);
    else
        return ffmpegFilterImageInternal(cp, options);
}

export async function ffmpegFilterImageInternal(cp: ChildProcess, options: FFmpegImageFilterOptions) {
    const buffers: Buffer[] = [];

    cp.stdio[3].on('data', data => buffers.push(data));

    const to = options.timeout ? setTimeout(() => {
        console.log('ffmpeg stream to image convesion timed out.');
        safeKillFFmpeg(cp);
    }, 10000) : undefined;

    const [exitCode] = await once(cp, 'exit');
    clearTimeout(to);
    if (exitCode)
        throw new Error(`ffmpeg stream to image convesion failed with exit code: ${exitCode}`);

    return Buffer.concat(buffers);
}

export async function ffmpegFilterImageStream(cp: ChildProcess, options: FFmpegImageFilterOptions) {
    const ret = new Promise<Buffer>((resolve, reject) => {
        const to = options.timeout ? setTimeout(() => {
            reject(new Error('ffmpeg stream to image convesion timed out.'));
        }, 10000) : undefined;

        const pipe = cp.stdio[3].pipe(new Pipe2Jpeg());
        let last: Buffer;
        let count = 0;
        pipe.on('jpeg', jpeg => {
            ++count;
            last = jpeg;
        });

        pipe.once('jpeg', async () => {
            clearTimeout(to);
            // convert images for the requested number of milliseconds before returning a value.
            // this may below through the prebuffer.
            await sleep(options.time);
            resolve(last);
        });

        cp.on('exit', exitCode => {
            clearTimeout(to);
            if (last)
                resolve(last);
            else
                reject(new Error(`ffmpeg stream to image convesion failed with exit code: ${exitCode}`));
        })
    });

    return ret.finally(() => safeKillFFmpeg(cp));
}