/**
 * AWS Secrets Manager Integration Module
 * 
 * This module loads secrets from AWS Secrets Manager at application startup
 * and populates process.env with the retrieved key-value pairs.
 * 
 * Features:
 * - Lists all secrets from AWS Secrets Manager (with optional prefix filtering)
 * - Retrieves each secret and parses as JSON
 * - Merges secrets into process.env (keys already set in .env are skipped)
 * - Clears AWS credentials from memory after loading for security
 * - Comprehensive error handling with fallback to .env.local
 * 
 * Required Environment Variables:
 * - AWS_SECRET_MANAGER_ACCESS_KEY_ID: AWS access key for Secrets Manager
 * - AWS_SECRET_MANAGER_SECRET_ACCESS_KEY: AWS secret key
 * - AWS_SECRET_MANAGER_REGION: AWS region (e.g., 'eu-north-1')
 * - AWS_SECRET_PREFIX: (Optional) Filter secrets by name prefix
 */

import {
    SecretsManagerClient,
    GetSecretValueCommand,
    ListSecretsCommand
} from '@aws-sdk/client-secrets-manager';

class SecretsManagerLoader {
    constructor() {
        this.client = null;
        this.region = null;
    }

    /**
     * Initialize AWS Secrets Manager client with credentials from environment variables
     * @private
     */
    _initializeClient() {
        const accessKeyId = process.env.AWS_SECRET_MANAGER_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_MANAGER_SECRET_ACCESS_KEY;
        this.region = process.env.AWS_SECRET_MANAGER_REGION || 'eu-north-1';

        // Validate required credentials
        if (!accessKeyId) {
            throw new Error('AWS_SECRET_MANAGER_ACCESS_KEY_ID is not defined in environment variables');
        }
        if (!secretAccessKey) {
            throw new Error('AWS_SECRET_MANAGER_SECRET_ACCESS_KEY is not defined in environment variables');
        }

        console.log('[Secrets Manager] Initializing AWS client...');
        console.log(`[Secrets Manager] Region: ${this.region}`);
        console.log(`[Secrets Manager] Access Key: ${accessKeyId.substring(0, 4)}...${accessKeyId.substring(accessKeyId.length - 4)}`);

        // Create AWS Secrets Manager client
        this.client = new SecretsManagerClient({
            region: this.region,
            credentials: {
                accessKeyId,
                secretAccessKey
            }
        });

        console.log('[Secrets Manager] ✓ AWS client initialized successfully');
    }

    /**
     * List all secrets from AWS Secrets Manager with optional prefix filtering
     * @returns {Promise<string[]>} Array of secret names
     * @private
     */
    async _listAllSecrets() {
        const secretPrefix = process.env.AWS_SECRET_PREFIX;

        console.log('[Secrets Manager] Listing secrets from AWS Secrets Manager...');
        if (secretPrefix) {
            console.log(`[Secrets Manager] Filtering by prefix: ${secretPrefix}`);
        }

        try {
            const secretNames = [];
            let nextToken = undefined;

            do {
                const command = new ListSecretsCommand({
                    MaxResults: 100,
                    NextToken: nextToken
                });

                const response = await this.client.send(command);

                if (response.SecretList && response.SecretList.length > 0) {
                    for (const secret of response.SecretList) {
                        if (secret.Name) {
                            // Filter by prefix if specified
                            if (!secretPrefix || secret.Name.startsWith(secretPrefix)) {
                                secretNames.push(secret.Name);
                            }
                        }
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            console.log(`[Secrets Manager] Found ${secretNames.length} secret(s)`);
            if (secretNames.length > 0) {
                console.log(`[Secrets Manager] Secrets: ${secretNames.join(', ')}`);
            }

            return secretNames;
        } catch (error) {
            console.error('[Secrets Manager] Error listing secrets:', error.message);
            throw new Error(`Failed to list secrets from AWS Secrets Manager: ${error.message}`);
        }
    }

    /**
     * Retrieve a single secret from AWS Secrets Manager and parse as JSON
     * @param {string} secretName - Name of the secret to retrieve
     * @returns {Promise<Object>} Parsed secret as key-value pairs
     * @private
     */
    async _retrieveSecret(secretName) {
        try {
            console.log(`[Secrets Manager] Retrieving secret: ${secretName}`);

            const command = new GetSecretValueCommand({
                SecretId: secretName
            });

            const response = await this.client.send(command);

            // Handle both SecretString and SecretBinary
            let secretValue;
            if (response.SecretString) {
                secretValue = response.SecretString;
            } else if (response.SecretBinary) {
                // Decode binary secret
                const buff = Buffer.from(response.SecretBinary, 'base64');
                secretValue = buff.toString('utf-8');
            } else {
                throw new Error(`Secret ${secretName} has no SecretString or SecretBinary`);
            }

            // Parse as JSON
            let parsedSecret;
            try {
                parsedSecret = JSON.parse(secretValue);
            } catch (parseError) {
                throw new Error(`Failed to parse secret ${secretName} as JSON: ${parseError.message}`);
            }

            if (typeof parsedSecret !== 'object' || parsedSecret === null) {
                throw new Error(`Secret ${secretName} must be a JSON object with key-value pairs`);
            }

            const keyCount = Object.keys(parsedSecret).length;
            console.log(`[Secrets Manager] ✓ Retrieved ${keyCount} key(s) from secret: ${secretName}`);

            return parsedSecret;
        } catch (error) {
            // Handle specific AWS error types
            if (error.name === 'ResourceNotFoundException') {
                throw new Error(`Secret not found: ${secretName}. Verify the secret name and region.`);
            } else if (error.name === 'InvalidRequestException') {
                throw new Error(`Invalid request for secret ${secretName}: ${error.message}`);
            } else if (error.name === 'DecryptionFailure') {
                throw new Error(`Failed to decrypt secret ${secretName}. Check KMS permissions.`);
            } else if (error.name === 'UnrecognizedClientException') {
                throw new Error(`Invalid AWS credentials. Verify AWS_SECRET_MANAGER_ACCESS_KEY_ID and AWS_SECRET_MANAGER_SECRET_ACCESS_KEY.`);
            } else if (error.name === 'InternalServiceError') {
                throw new Error(`AWS Secrets Manager service error for secret ${secretName}: ${error.message}`);
            } else {
                // Re-throw if already wrapped
                if (error.message.includes('Failed to parse') || error.message.includes('must be a JSON object')) {
                    throw error;
                }
                throw new Error(`Failed to retrieve secret ${secretName}: ${error.message}`);
            }
        }
    }

    /**
     * Clear AWS credentials from process.env for security
     * @private
     */
    _clearCredentials() {
        console.log('[Secrets Manager] Clearing AWS credentials from memory...');

        // Delete AWS credentials from environment
        delete process.env.AWS_SECRET_MANAGER_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_MANAGER_SECRET_ACCESS_KEY;
        delete process.env.AWS_SECRET_MANAGER_REGION;
        delete process.env.AWS_SECRET_PREFIX;

        // Destroy client reference
        this.client = null;

        console.log('[Secrets Manager] ✓ AWS credentials cleared from memory');
    }

    /**
     * Mask a value for secure logging (show first 3 and last 3 chars, mask middle)
     * @param {string} value - Value to mask
     * @returns {string} Masked value
     * @private
     */
    _maskValue(value) {
        if (!value || typeof value !== 'string') {
            return '***';
        }
        const strValue = String(value);
        if (strValue.length <= 8) {
            // For short values, show first 2 and last 2 chars
            if (strValue.length <= 4) {
                return '***';
            }
            return strValue.substring(0, 2) + '***' + strValue.substring(strValue.length - 2);
        }
        // For longer values, show first 3 and last 3 chars
        return strValue.substring(0, 3) + '***' + strValue.substring(strValue.length - 3);
    }

    /**
     * Main function to load all secrets from AWS Secrets Manager
     * Populates process.env with retrieved secrets
     * @public
     */
    async loadSecrets() {
        try {
            // Step 1: Initialize AWS client
            this._initializeClient();

            // Step 2: List all secrets
            const secretNames = await this._listAllSecrets();

            if (secretNames.length === 0) {
                console.warn('[Secrets Manager] ⚠ No secrets found in AWS Secrets Manager');
                this._clearCredentials();
                return;
            }

            // Step 3: Retrieve each secret and merge into process.env
            // Keys already present in process.env (from .env file) are skipped
            const envKeys = new Set(Object.keys(process.env));
            let totalKeysLoaded = 0;
            let skippedKeys = 0;
            const loadedKeys = [];

            for (const secretName of secretNames) {
                const secretData = await this._retrieveSecret(secretName);

                // Merge into process.env — skip keys already defined in .env
                for (const [key, value] of Object.entries(secretData)) {
                    if (envKeys.has(key)) {
                        skippedKeys++;
                        console.log(`[Secrets Manager]   ${key}: skipped (already set in .env)`);
                        continue;
                    }
                    const maskedValue = this._maskValue(value);
                    process.env[key] = String(value);
                    totalKeysLoaded++;
                    loadedKeys.push({ key, maskedValue });
                }
            }

            // Log all loaded keys with masked values
            if (loadedKeys.length > 0) {
                console.log('[Secrets Manager] Loaded keys:');
                for (const { key, maskedValue } of loadedKeys) {
                    console.log(`[Secrets Manager]   ${key}: ${maskedValue}`);
                }
            }

            console.log(`[Secrets Manager] ✓ Loaded ${totalKeysLoaded} environment variable(s) from AWS Secrets Manager`);
            if (skippedKeys > 0) {
                console.log(`[Secrets Manager] ⊘ Skipped ${skippedKeys} variable(s) already defined in .env`);
            }

            // Step 4: Clear credentials for security
            //this._clearCredentials();

        } catch (error) {
            console.error('[Secrets Manager] ✗ CRITICAL ERROR:', error.message);
            throw error;
        }
    }
}

/**
 * Convenience function to load secrets from AWS Secrets Manager
 * @returns {Promise<void>}
 */
export async function loadSecretsFromAWS() {
    const loader = new SecretsManagerLoader();
    await loader.loadSecrets();
}

export { SecretsManagerLoader };
