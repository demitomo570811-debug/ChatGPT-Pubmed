//+------------------------------------------------------------------+
//|                                              KronosMonitor.mq4   |
//|                          Kronos Account Monitor EA               |
//+------------------------------------------------------------------+
#property copyright "KronosMonitor"
#property version   "1.00"
#property strict

//--- 接続設定
input string AccountServer     = "XMTrading-Real 31";  // 接続サーバー
input int    AccountId         = 41137395;             // MT4口座ID

//--- パラメータ
input int    MAGIC_NUMBER      = 0;       // マジックナンバー（EAファイル確認後に設定）
input int    HEARTBEAT_SEC     = 30;      // ハートビート間隔（秒）
input string OUTPUT_FILE       = "kronos_status.json"; // 出力ファイル名

//--- グローバル
datetime g_lastBeat = 0;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("KronosMonitor started. Server=", AccountServer,
         " AccountId=", AccountId,
         " MAGIC=", MAGIC_NUMBER,
         " Interval=", HEARTBEAT_SEC, "s");
   // 初回即時送信
   WriteStatus();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("KronosMonitor stopped. reason=", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if (TimeCurrent() - g_lastBeat < HEARTBEAT_SEC)
      return;
   g_lastBeat = TimeCurrent();
   WriteStatus();
}

//+------------------------------------------------------------------+
//| OnTimer (バックアップ: ティックが来ない時間帯用)                 |
//+------------------------------------------------------------------+
void OnTimer()
{
   if (TimeCurrent() - g_lastBeat < HEARTBEAT_SEC)
      return;
   g_lastBeat = TimeCurrent();
   WriteStatus();
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
   json += "\"account_id\":" + IntegerToString(AccountId) + ",";
   json += "\"server\":\"" + AccountServer + "\",";
   json += "\"balance\":" + DoubleToString(bal, 2) + ",";
   json += "\"equity\":" + DoubleToString(eq, 2) + ",";
   json += "\"dd_percent\":" + DoubleToString(dd, 2) + ",";
   json += "\"magic\":" + IntegerToString(MAGIC_NUMBER) + ",";
   json += "\"timestamp\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"positions\":" + positions;
   json += "}";

   //--- ファイル書き出し (MQL4/Files/kronos_status.json)
   int handle = FileOpen(OUTPUT_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
   }
   else
   {
      Print("KronosMonitor: FileOpen failed. error=", GetLastError());
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

      // MAGIC_NUMBER が 0 の場合は全ポジション、それ以外はmagic一致分のみ
      if (MAGIC_NUMBER != 0 && OrderMagicNumber() != MAGIC_NUMBER)
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
