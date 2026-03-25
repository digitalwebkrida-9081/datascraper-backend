/**
 * Currency Exchange Rate Controller
 * Detects user's country from IP and returns live USD exchange rates
 */

// In-memory cache for exchange rates (refreshed every hour)
let ratesCache = null;
let ratesCacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Country code → currency code mapping
const countryCurrencyMap = {
    'IN': { currency: 'INR', symbol: '₹', name: 'Indian Rupee' },
    'GB': { currency: 'GBP', symbol: '£', name: 'British Pound' },
    'UK': { currency: 'GBP', symbol: '£', name: 'British Pound' },
    'EU': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'DE': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'FR': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'IT': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'ES': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'NL': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'BE': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'AT': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'IE': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'PT': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'FI': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'GR': { currency: 'EUR', symbol: '€', name: 'Euro' },
    'JP': { currency: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    'CN': { currency: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
    'KR': { currency: 'KRW', symbol: '₩', name: 'South Korean Won' },
    'CA': { currency: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
    'AU': { currency: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
    'NZ': { currency: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
    'BR': { currency: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    'MX': { currency: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
    'AR': { currency: 'ARS', symbol: 'AR$', name: 'Argentine Peso' },
    'CL': { currency: 'CLP', symbol: 'CL$', name: 'Chilean Peso' },
    'CO': { currency: 'COP', symbol: 'CO$', name: 'Colombian Peso' },
    'ZA': { currency: 'ZAR', symbol: 'R', name: 'South African Rand' },
    'AE': { currency: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
    'SA': { currency: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
    'TR': { currency: 'TRY', symbol: '₺', name: 'Turkish Lira' },
    'PK': { currency: 'PKR', symbol: '₨', name: 'Pakistani Rupee' },
    'BD': { currency: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
    'LK': { currency: 'LKR', symbol: '₨', name: 'Sri Lankan Rupee' },
    'NP': { currency: 'NPR', symbol: '₨', name: 'Nepalese Rupee' },
    'TH': { currency: 'THB', symbol: '฿', name: 'Thai Baht' },
    'MY': { currency: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
    'SG': { currency: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    'PH': { currency: 'PHP', symbol: '₱', name: 'Philippine Peso' },
    'ID': { currency: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
    'NG': { currency: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
    'EG': { currency: 'EGP', symbol: 'E£', name: 'Egyptian Pound' },
    'KE': { currency: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
    'SE': { currency: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
    'CH': { currency: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
    'PL': { currency: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
    'RU': { currency: 'RUB', symbol: '₽', name: 'Russian Ruble' },
    'UA': { currency: 'UAH', symbol: '₴', name: 'Ukrainian Hryvnia' },
    'IL': { currency: 'ILS', symbol: '₪', name: 'Israeli Shekel' },
    'HK': { currency: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
    'TW': { currency: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar' },
    'VN': { currency: 'VND', symbol: '₫', name: 'Vietnamese Dong' },
    'NO': { currency: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
    'DK': { currency: 'DKK', symbol: 'kr', name: 'Danish Krone' },
};

/**
 * Fetch and cache exchange rates from open.er-api.com (free, no key required)
 */
async function getExchangeRates() {
    const now = Date.now();
    if (ratesCache && (now - ratesCacheTime) < CACHE_DURATION) {
        return ratesCache;
    }

    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();

        if (data.result === 'success' && data.rates) {
            ratesCache = data.rates;
            ratesCacheTime = now;
            console.log('[CURRENCY] Exchange rates cached successfully');
            return ratesCache;
        }

        throw new Error('Invalid exchange rate API response');
    } catch (error) {
        console.error('[CURRENCY] Failed to fetch exchange rates:', error.message);
        // Return cached data even if expired, as a fallback
        if (ratesCache) return ratesCache;
        return null;
    }
}

/**
 * Detect user's country from IP
 */
async function detectCountry(req) {
    // 1. Check Cloudflare header first (most reliable if behind CF)
    const cfCountry = req.headers['cf-ipcountry'];
    if (cfCountry && cfCountry !== 'XX') return cfCountry.toUpperCase();

    // 2. Try x-vercel-ip-country (if behind Vercel)
    const vercelCountry = req.headers['x-vercel-ip-country'];
    if (vercelCountry) return vercelCountry.toUpperCase();

    // 3. Fall back to IP geolocation
    try {
        // Get the real IP from various headers
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection?.remoteAddress ||
                   req.ip;

        // Skip localhost/private IPs
        if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            return null;
        }

        const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
        const data = await response.json();
        if (data.countryCode) return data.countryCode.toUpperCase();
    } catch (error) {
        console.error('[CURRENCY] IP geolocation failed:', error.message);
    }

    return null;
}

/**
 * GET /api/currency/rate
 * Returns the user's local currency, exchange rate, and symbol
 */
exports.getExchangeRate = async (req, res) => {
    try {
        const countryCode = await detectCountry(req);

        // If we can't detect country, or it's US, no conversion needed
        if (!countryCode || countryCode === 'US') {
            return res.json({
                success: true,
                data: {
                    countryCode: countryCode || 'US',
                    currency: 'USD',
                    symbol: '$',
                    name: 'US Dollar',
                    rate: 1,
                    needsConversion: false
                }
            });
        }

        const currencyInfo = countryCurrencyMap[countryCode];
        if (!currencyInfo) {
            // Unknown country, return USD
            return res.json({
                success: true,
                data: {
                    countryCode,
                    currency: 'USD',
                    symbol: '$',
                    name: 'US Dollar',
                    rate: 1,
                    needsConversion: false
                }
            });
        }

        const rates = await getExchangeRates();
        if (!rates || !rates[currencyInfo.currency]) {
            return res.json({
                success: true,
                data: {
                    countryCode,
                    currency: currencyInfo.currency,
                    symbol: currencyInfo.symbol,
                    name: currencyInfo.name,
                    rate: null,
                    needsConversion: false,
                    error: 'Exchange rate unavailable'
                }
            });
        }

        return res.json({
            success: true,
            data: {
                countryCode,
                currency: currencyInfo.currency,
                symbol: currencyInfo.symbol,
                name: currencyInfo.name,
                rate: rates[currencyInfo.currency],
                needsConversion: true
            }
        });

    } catch (error) {
        console.error('[CURRENCY] Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get exchange rate' });
    }
};
