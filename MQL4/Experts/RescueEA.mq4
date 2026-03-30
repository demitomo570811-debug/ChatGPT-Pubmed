//+------------------------------------------------------------------+
//|                                                  RescueEA.mq4    |
//|                              RescueEA v2.7 - Heartbeat Monitor   |
//+------------------------------------------------------------------+
#property copyright "RescueEA v2.7"
#property version   "2.70"
#property strict

//--- ファイル名パラメータ（inputで外部設定可能）
input string HEARTBEAT_FILE = "rescue_heartbeat.json";  // ハートビートファイル名
input string OUTPUT_FILE    = "rescue_status.json";      // ステータス出力ファイル名

//--- パラメータ
input int    MAGIC_NUMBER   = 777;      // マジックナンバー
input int    HEARTBEAT_SEC  = 30;       // ハートビート間隔（秒）
input double DD_ALERT_PCT   = 20.0;     // DD警告閾値（%）

//--- グローバル
datetime g_lastBeat = 0;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(HEARTBEAT_SEC);
   Print("RescueEA v2.7 started. MAGIC=", MAGIC_NUMBER,
         " Interval=", HEARTBEAT_SEC, "s",
         " HeartbeatFile=", HEARTBEAT_FILE,
         " OutputFile=", OUTPUT_FILE);
   WriteHeartbeat();
   WriteStatus();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("RescueEA v2.7 stopped. reason=", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if (TimeCurrent() - g_lastBeat < HEARTBEAT_SEC)
      return;
   g_lastBeat = TimeCurrent();
   WriteHeartbeat();
   WriteStatus();
}

//+------------------------------------------------------------------+
//| OnTimer                                                          |
//+------------------------------------------------------------------+
void OnTimer()
{
   if (TimeCurrent() - g_lastBeat < HEARTBEAT_SEC)
      return;
   g_lastBeat = TimeCurrent();
   WriteHeartbeat();
   WriteStatus();
}

//+------------------------------------------------------------------+
//| ハートビートJSON書き出し                                          |
//+------------------------------------------------------------------+
void WriteHeartbeat()
{
   string json = "{";
   json += "\"timestamp\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"magic\":" + IntegerToString(MAGIC_NUMBER) + ",";
   json += "\"status\":\"alive\"";
   json += "}";

   int handle = FileOpen(HEARTBEAT_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
   }
   else
   {
      Print("RescueEA: HeartbeatFile open failed. error=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| ステータスJSON書き出し                                            |
//+------------------------------------------------------------------+
void WriteStatus()
{
   double bal = AccountBalance();
   double eq  = AccountEquity();
   double dd  = 0.0;
   if (bal > 0)
      dd = (bal - eq) / bal * 100.0;

   //--- magic一致ポジションを収集
   string positions = BuildPositionsJson();

   //--- JSON組み立て
   string json = "{";
   json += "\"balance\":" + DoubleToString(bal, 2) + ",";
   json += "\"equity\":" + DoubleToString(eq, 2) + ",";
   json += "\"dd_percent\":" + DoubleToString(dd, 2) + ",";
   json += "\"magic\":" + IntegerToString(MAGIC_NUMBER) + ",";
   json += "\"timestamp\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"positions\":" + positions;
   json += "}";

   int handle = FileOpen(OUTPUT_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
   }
   else
   {
      Print("RescueEA: OutputFile open failed. error=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| MAGIC一致ポジションのJSON配列を生成                               |
//+------------------------------------------------------------------+
string BuildPositionsJson()
{
   string result = "[";
   bool first = true;

   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if (OrderMagicNumber() != MAGIC_NUMBER)
         continue;

      if (!first) result += ",";
      first = false;

      result += "{";
      result += "\"ticket\":" + IntegerToString(OrderTicket()) + ",";
      result += "\"symbol\":\"" + OrderSymbol() + "\",";
      result += "\"type\":" + IntegerToString(OrderType()) + ",";
      result += "\"lots\":" + DoubleToString(OrderLots(), 2) + ",";
      result += "\"open_price\":" + DoubleToString(OrderOpenPrice(), 5) + ",";
      result += "\"profit\":" + DoubleToString(OrderProfit(), 2) + ",";
      result += "\"magic\":" + IntegerToString(OrderMagicNumber());
      result += "}";
   }

   result += "]";
   return result;
}
//+------------------------------------------------------------------+
