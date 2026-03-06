const axios = require('axios');

/**
 * Performs a network HTTP request.
 * @param {Object} options - { method, url, data, headers, params }
 */
async function httpRequest(options) {
    try {
        const response = await axios({
            method: options.method || 'get',
            url: options.url,
            data: options.data,
            params: options.params,
            headers: options.headers || {},
            timeout: 10000 // 10 second timeout default
        });

        return {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
        };
    } catch (err) {
        if (err.response) {
            return {
                error: true,
                status: err.response.status,
                statusText: err.response.statusText,
                data: err.response.data
            };
        }
        return { error: true, message: err.message };
    }
}

module.exports = {
    httpRequest
};
