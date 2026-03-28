import Lead from '../models/leadModel.js';
import { performAggregate } from '../config/mongoConnector.js';

class AnalyticsService {
    /**
     * Get chart data with grouping and aggregation
     * @param {Object} params - Query parameters
     * @param {string} params.xAxis - Field to group by for X-axis (e.g., 'trainerName')
     * @param {string} params.yAxis - Field to aggregate for Y-axis (e.g., 'memberName')
     * @param {string} params.aggregation - Aggregation type (count, sum, avg, min, max)
     * @param {Object} params.dateFilter - Optional date range filter { from: Date, to: Date }
     * @returns {Promise<Array>} - Aggregated chart data
     */
    async getChartData({ xAxis, yAxis, zAxis, aggregation, dateFilter, acctId, categoryId }) {
        try {
            const pipeline = [];

            // Stage 1: Always filter by acctId
            const matchStage = { acctId };

            // Filter by categoryId if provided
            if (categoryId) {
                matchStage.categoryId = categoryId;
            }

            // Filter by date if provided
            if (dateFilter && (dateFilter.from || dateFilter.to)) {
                const dateMatch = {};
                if (dateFilter.from) dateMatch.$gte = dateFilter.from;
                if (dateFilter.to) dateMatch.$lte = dateFilter.to;
                matchStage.updatedAt = dateMatch;
            }

            pipeline.push({ $match: matchStage });

            if (zAxis) {
                // Grouped / Stacked mode: group by both xAxis and zAxis
                // Returns [{name, zKey, value}] so the frontend can pivot into multi-series

                // Stage 2: Group by composite (xAxis + zAxis)
                pipeline.push({
                    $group: {
                        _id: {
                            name: `$${xAxis}`,
                            zKey: `$${zAxis}`
                        },
                        value: this._getAggregationExpression(aggregation, yAxis)
                    }
                });

                // Stage 3: Sort by xAxis name then zKey for consistent ordering
                pipeline.push({ $sort: { '_id.name': 1, '_id.zKey': 1 } });

                // Stage 4: Cap results
                pipeline.push({ $limit: 500 });

                // Stage 5: Project to {name, zKey, value}
                pipeline.push({
                    $project: {
                        _id: 0,
                        name: '$_id.name',
                        zKey: '$_id.zKey',
                        value: 1
                    }
                });
            } else {
                // Standard single-axis mode
                // Stage 2: Group by xAxis and aggregate yAxis
                pipeline.push({
                    $group: {
                        _id: `$${xAxis}`,
                        value: this._getAggregationExpression(aggregation, yAxis)
                    }
                });

                // Stage 3: Sort by value descending so top results are returned first
                pipeline.push({ $sort: { value: -1 } });

                // Stage 4: Cap at 50 groups to prevent massive payloads
                pipeline.push({ $limit: 50 });

                // Stage 5: Project to format the output
                pipeline.push({
                    $project: {
                        _id: 0,
                        name: '$_id',
                        value: 1
                    }
                });
            }

            return await performAggregate(Lead, pipeline);
        } catch (error) {
            console.error('Error in getChartData:', error);
            throw new Error(`Failed to retrieve chart data: ${error.message}`);
        }
    }

    /**
     * Get the appropriate MongoDB aggregation expression based on type
     * @private
     */
    _getAggregationExpression(aggregation, field) {
        const expressions = {
            count: { $sum: 1 },
            sum: { $sum: `$${field}` },
            avg: { $avg: `$${field}` },
            min: { $min: `$${field}` },
            max: { $max: `$${field}` }
        };

        return expressions[aggregation] || { $sum: 1 };
    }
}

export default new AnalyticsService();
