import analyticsService from '../services/analyticsService.js';

class AnalyticsController {
  /**
   * Get chart data
   * GET /api/analytics/chart-data
   */
  async getChartData(req, res) {
    try {
      const { xAxis, yAxis, aggregation, dateFrom, dateTo, acctId } = req.query;

      // Validation
      if (!xAxis || !yAxis || !aggregation) {
        return res.status(400).json({
          success: false,
          message: 'xAxis, yAxis, and aggregation are required parameters'
        });
      }

      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'acctId is required'
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
        aggregation,
        dateFilter,
        acctId
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
