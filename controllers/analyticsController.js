import analyticsService from '../services/analyticsService.js';

class AnalyticsController {
  /**
   * Get chart data
   * GET /api/analytics/chart-data
   */
  async getChartData(req, res) {
    try {
      // Support both POST (body) and GET (query params)
      const source = req.body && Object.keys(req.body).length ? req.body : req.query;
      const { xAxis, yAxis, zAxis, aggregation, dateFrom, dateTo, categoryId, acctId: acctIdSource, dateGranularity } = source;

      // Prefer acctId from the authenticated user's token; fall back to body/query param
      const acctId = req.user?.acctId || acctIdSource;
      if (!acctId) {
        return res.status(403).json({
          success: false,
          message: 'No account associated with this session'
        });
      }

      // Validation
      if (!xAxis || !yAxis || !aggregation) {
        return res.status(400).json({
          success: false,
          message: 'xAxis, yAxis, and aggregation are required parameters'
        });
      }

      // Validate aggregation type
      const validAggregations = ['count', 'sum', 'avg', 'min', 'max'];
      if (!validAggregations.includes(aggregation)) {
        return res.status(400).json({
          success: false,
          message: `Invalid aggregation type. Allowed values: ${validAggregations.join(', ')}`
        });
      }

      // Validate dateGranularity if provided
      const validGranularities = ['hour', 'day', 'month', 'year'];
      const resolvedGranularity = validGranularities.includes(dateGranularity) ? dateGranularity : null;

      // Parse and validate dates if provided
      let dateFilter = null;
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(new Date(dateTo).setHours(23, 59, 59, 999)) : null;

        if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)'
          });
        }

        dateFilter = { from, to };
      }

      const chartData = await analyticsService.getChartData({
        xAxis,
        yAxis,
        zAxis: zAxis || null,
        aggregation,
        dateFilter,
        acctId,
        categoryId: categoryId || null,
        dateGranularity: resolvedGranularity
      });

      return res.status(200).json({
        success: true,
        message: 'Chart data retrieved successfully',
        data: chartData
      });
    } catch (error) {
      console.error('Error in getChartData:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: 'Error retrieving chart data',
        error: error.message
      });
    }
  }
}

export default new AnalyticsController();
