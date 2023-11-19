import sdk, { EventListenerRegister, MotionSensor, ObjectDetector, ObjectsDetected, Readme, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, SettingValue, Settings } from "@scrypted/sdk";
import { StorageSetting, StorageSettings } from "@scrypted/sdk/storage-settings";

export const SMART_MOTIONSENSOR_PREFIX = 'smart-motionsensor-';

export function createObjectDetectorStorageSetting(): StorageSetting {
    return {
        key: 'objectDetector',
        title: 'Object Detector',
        description: 'Select the camera or doorbell that provides smart detection event.',
        type: 'device',
        deviceFilter: `(type === '${ScryptedDeviceType.Doorbell}' || type === '${ScryptedDeviceType.Camera}') && interfaces.includes('${ScryptedInterface.ObjectDetector}')`,
    };
}

export class SmartMotionSensor extends ScryptedDeviceBase implements Settings, Readme, MotionSensor {
    storageSettings = new StorageSettings(this, {
        objectDetector: createObjectDetectorStorageSetting(),
        detections: {
            title: 'Detections',
            description: 'The detections that will trigger this smart motion sensor.',
            multiple: true,
            choices: [],
        },
        detectionTimeout: {
            title: 'Object Detection Timeout',
            description: 'Duration in seconds the sensor will report motion, before resetting.',
            type: 'number',
            defaultValue: 60,
        },
    });
    listener: EventListenerRegister;
    timeout: NodeJS.Timeout;

    constructor(nativeId?: ScryptedNativeId) {
        super(nativeId);

        this.storageSettings.settings.detections.onGet = async () => {
            const objectDetector: ObjectDetector = this.storageSettings.values.objectDetector;
            const choices = (await objectDetector?.getObjectTypes())?.classes || [];
            return {
                hide: !objectDetector,
                choices,
            };
        };

        this.storageSettings.settings.detections.onPut = () => this.rebind();

        this.storageSettings.settings.objectDetector.onPut = () => this.rebind();

        this.rebind();
    }

    resetTrigger() {
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }

    trigger() {
        this.resetTrigger();
        const duration: number = this.storageSettings.values.detectionTimeout;
        this.motionDetected = true;
        this.timeout = setTimeout(() => {
            this.motionDetected = false;
        }, duration * 1000);
    }

    rebind() {
        this.motionDetected = false;
        this.listener?.removeListener();
        this.listener = undefined;
        this.resetTrigger();


        const objectDetector: ObjectDetector & ScryptedDevice = this.storageSettings.values.objectDetector;
        if (!objectDetector)
            return;

        const detections: string[] = this.storageSettings.values.detections;
        if (!detections?.length)
            return;


        const console = sdk.deviceManager.getMixinConsole(objectDetector.id, this.nativeId);

        this.listener = objectDetector.listen(ScryptedInterface.ObjectDetector, (source, details, data) => {
            const detected: ObjectsDetected = data;
            const match = detected.detections?.find(d => {
                if (!detections.includes(d.className))
                    return false;
                if (!d.movement)
                    return true;
                return d.movement.moving;
            })
            if (match) {
                if (!this.motionDetected)
                    console.log('Smart Motion Sensor triggered on', match);
                this.trigger();
            }
        });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async getReadmeMarkdown(): Promise<string> {
        return `
## Smart Motion Sensor

This Smart Motion Sensor can trigger when a specific type of object (car, person, dog, etc) triggers movement on a camera. The sensor can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This Sensor requires a camera with hardware or software object detection capability.`;
    }
}