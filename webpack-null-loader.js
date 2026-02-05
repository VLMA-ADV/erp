// Simple null loader for webpack to ignore Supabase Edge Functions
module.exports = function() {
  return 'module.exports = {};';
};
